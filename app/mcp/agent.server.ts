import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";

import { createLog, getLogListItems } from "~/models/log.server";
import { getLatestOdometer } from "~/models/odometer.server";
import {
  addProjectItem,
  getProject,
  listProjects,
  updateProjectItemStatus,
} from "~/models/project.server";
import { ITEM_STATUSES } from "~/models/project.shared";
import {
  completeReminder,
  listReminders,
  type ReminderWithStatus,
} from "~/models/reminder.server";
import { getVehicle, getVehicleListItems } from "~/models/vehicle.server";

/**
 * Token props minted in /authorize (completeAuthorization) and decrypted by
 * workers-oauth-provider on every authenticated /mcp request. Must stay a
 * type alias (not interface) to satisfy McpAgent's Record constraint.
 */
export type LogbookMcpProps = {
  userId: string;
  email: string;
};

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }
}

function parseIsoDate(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${field}: ${value} (expected an ISO 8601 date)`);
  }
  return date;
}

function reminderSummary(reminder: ReminderWithStatus) {
  return {
    id: reminder.id,
    title: reminder.title,
    notes: reminder.notes,
    status: reminder.status,
    dueDate: reminder.dueDate?.toISOString() ?? null,
    dueMiles: reminder.dueMiles,
    daysLeft: reminder.daysLeft,
    milesLeft: reminder.milesLeft,
    intervalMonths: reminder.intervalMonths,
    intervalMiles: reminder.intervalMiles,
  };
}

/**
 * Remote MCP server for Logbook. Every tool is a thin wrapper over the
 * app/models layer, which enforces crew-membership authorization — tools
 * only supply the `userId` carried in the OAuth token props, so the MCP
 * surface can never read wider than the logged-in user could in the app.
 */
export class LogbookMCP extends McpAgent<
  Cloudflare.Env,
  unknown,
  LogbookMcpProps
> {
  server = new McpServer({ name: "Logbook", version: "1.0.0" });

  private requireUserId(): string {
    const userId = this.props?.userId;
    if (!userId) throw new Error("Not authenticated");
    return userId;
  }

  async init() {
    this.server.tool(
      "list_vehicles",
      "List every vehicle the signed-in user owns or crews on, with the latest odometer reading and counts of overdue / due-soon reminders. Use this first to find vehicle ids for the other tools.",
      {},
      async () =>
        run(async () => {
          const userId = this.requireUserId();
          const vehicles = await getVehicleListItems({ userId });
          return vehicles.map((v) => ({
            id: v.id,
            name: v.name,
            year: v.year,
            make: v.make,
            model: v.model,
            trim: v.trim,
            engine: v.engine,
            vin: v.vin,
            role: v.role,
            latestOdometer: v.latestOdometer,
            overdueCount: v.overdueCount,
            dueSoonCount: v.dueSoonCount,
          }));
        }),
    );

    this.server.tool(
      "get_vehicle_status",
      "Snapshot of one vehicle: details, latest odometer, active reminders (with due status), and the most recent maintenance logs.",
      {
        vehicleId: z.string().describe("Vehicle id (from list_vehicles)"),
      },
      async ({ vehicleId }) =>
        run(async () => {
          const userId = this.requireUserId();
          const vehicle = await getVehicle({ id: vehicleId, userId });
          if (!vehicle) throw new Error("Vehicle not found");
          const [latest, reminders, recentLogs] = await Promise.all([
            getLatestOdometer({ vehicleId }),
            listReminders({ vehicleId, userId }),
            getLogListItems({ vehicleId, userId, limit: 5 }),
          ]);
          return {
            vehicle: {
              id: vehicle.id,
              name: vehicle.name,
              year: vehicle.year,
              make: vehicle.make,
              model: vehicle.model,
              trim: vehicle.trim,
              engine: vehicle.engine,
              vin: vehicle.vin,
              role: vehicle.role,
            },
            latestOdometer: latest
              ? {
                  odometer: latest.odometer,
                  date: latest.date.toISOString(),
                  source: latest.source,
                }
              : null,
            reminders: reminders
              .filter((r) => r.status !== "done")
              .map(reminderSummary),
            recentLogs: recentLogs.map((log) => ({
              id: log.id,
              title: log.title,
              type: log.type,
              cost: log.cost,
              odometer: log.odometer,
              servicedAt: log.servicedAt.toISOString(),
              mechanicName: log.mechanicName,
              authorName: log.authorName,
            })),
          };
        }),
    );

    this.server.tool(
      "whats_due",
      "Overdue and due-soon service reminders. Pass a vehicleId to scope to one vehicle; omit it to sweep every vehicle the user can access.",
      {
        vehicleId: z
          .string()
          .optional()
          .describe("Optional vehicle id; omit to check all vehicles"),
      },
      async ({ vehicleId }) =>
        run(async () => {
          const userId = this.requireUserId();
          const vehicles = vehicleId
            ? [{ id: vehicleId, name: null as string | null }]
            : (await getVehicleListItems({ userId })).map((v) => ({
                id: v.id,
                name: v.name as string | null,
              }));
          const due = [];
          for (const vehicle of vehicles) {
            const reminders = await listReminders({
              vehicleId: vehicle.id,
              userId,
            });
            for (const reminder of reminders) {
              if (
                reminder.status !== "overdue" &&
                reminder.status !== "due_soon"
              )
                continue;
              due.push({
                vehicleId: vehicle.id,
                vehicleName: vehicle.name,
                ...reminderSummary(reminder),
              });
            }
          }
          return due;
        }),
    );

    this.server.tool(
      "log_work",
      "Record completed maintenance or repair work as a new log entry on a vehicle.",
      {
        vehicleId: z.string().describe("Vehicle id (from list_vehicles)"),
        title: z.string().describe("Short title, e.g. 'Oil change'"),
        notes: z
          .string()
          .optional()
          .describe("Details: parts, fluids, torque specs, observations"),
        type: z
          .string()
          .optional()
          .describe("Service type — typically Minor, Major, Modify, or Check"),
        cost: z.number().optional().describe("Total cost in dollars"),
        odometer: z
          .number()
          .optional()
          .describe("Odometer reading at service time, in miles"),
        servicedAt: z
          .string()
          .optional()
          .describe("ISO 8601 date the work was completed; defaults to now"),
        selfService: z
          .boolean()
          .optional()
          .describe("True if the work was done by the crew rather than a shop"),
      },
      async ({
        vehicleId,
        title,
        notes,
        type,
        cost,
        odometer,
        servicedAt,
        selfService,
      }) =>
        run(async () => {
          const userId = this.requireUserId();
          const log = await createLog({
            vehicleId,
            userId,
            title,
            notes: notes ?? null,
            type: type ?? null,
            cost: cost ?? null,
            odometer: odometer ?? null,
            ...(servicedAt
              ? { servicedAt: parseIsoDate(servicedAt, "servicedAt") }
              : {}),
            selfService: selfService ?? false,
          });
          return {
            id: log.id,
            title: log.title,
            servicedAt: log.servicedAt.toISOString(),
            odometer: log.odometer,
            cost: log.cost,
          };
        }),
    );

    this.server.tool(
      "complete_reminder",
      "Mark a service reminder done. Recurring reminders roll forward to their next due date/mileage instead of closing.",
      {
        vehicleId: z.string().describe("Vehicle id the reminder belongs to"),
        reminderId: z
          .string()
          .describe("Reminder id (from whats_due or get_vehicle_status)"),
        odometer: z
          .number()
          .optional()
          .describe(
            "Odometer at completion — used to compute the next due mileage for recurring reminders",
          ),
      },
      async ({ vehicleId, reminderId, odometer }) =>
        run(async () => {
          const userId = this.requireUserId();
          const reminder = await completeReminder({
            id: reminderId,
            vehicleId,
            userId,
            odometer,
          });
          if (!reminder) throw new Error("Reminder not found");
          return {
            id: reminder.id,
            title: reminder.title,
            completedAt: reminder.completedAt?.toISOString() ?? null,
            nextDueDate: reminder.dueDate?.toISOString() ?? null,
            nextDueMiles: reminder.dueMiles,
            recurring:
              reminder.intervalMonths != null || reminder.intervalMiles != null,
          };
        }),
    );

    this.server.tool(
      "list_projects",
      "List a vehicle's projects (planned work / builds) with item counts and cost totals. Pass projectId to get one project's full parts list.",
      {
        vehicleId: z.string().describe("Vehicle id (from list_vehicles)"),
        projectId: z
          .string()
          .optional()
          .describe("Optional project id to fetch its items"),
      },
      async ({ vehicleId, projectId }) =>
        run(async () => {
          const userId = this.requireUserId();
          if (projectId) {
            const project = await getProject({
              id: projectId,
              vehicleId,
              userId,
            });
            if (!project) throw new Error("Project not found");
            return {
              id: project.id,
              title: project.title,
              description: project.description,
              status: project.status,
              targetDate: project.targetDate?.toISOString() ?? null,
              items: project.items.map((item) => ({
                id: item.id,
                name: item.name,
                status: item.status,
                price: item.price,
                quantity: item.quantity,
                url: item.url,
                notes: item.notes,
              })),
            };
          }
          const projects = await listProjects({ vehicleId, userId });
          return projects.map((p) => ({
            id: p.id,
            title: p.title,
            description: p.description,
            status: p.status,
            targetDate: p.targetDate?.toISOString() ?? null,
            itemCount: p.itemCount,
            estimatedTotal: p.estimatedTotal,
            committedTotal: p.committedTotal,
          }));
        }),
    );

    this.server.tool(
      "add_project_item",
      "Add a part or task to a project's pipeline (it starts as 'proposed').",
      {
        vehicleId: z.string().describe("Vehicle id the project belongs to"),
        projectId: z.string().describe("Project id (from list_projects)"),
        name: z.string().describe("Part or task name"),
        url: z.string().optional().describe("Product / reference URL"),
        price: z.number().optional().describe("Unit price in dollars"),
        quantity: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Quantity (default 1)"),
        notes: z.string().optional(),
      },
      async ({ vehicleId, projectId, name, url, price, quantity, notes }) =>
        run(async () => {
          const userId = this.requireUserId();
          const item = await addProjectItem({
            vehicleId,
            userId,
            projectId,
            name,
            url: url ?? null,
            price: price ?? null,
            quantity: quantity ?? 1,
            notes: notes ?? null,
          });
          return {
            id: item.id,
            name: item.name,
            status: item.status,
            price: item.price,
            quantity: item.quantity,
          };
        }),
    );

    this.server.tool(
      "update_item_status",
      "Move a project item through the parts pipeline: proposed → ordered → received → installed.",
      {
        vehicleId: z.string().describe("Vehicle id the project belongs to"),
        projectId: z.string().describe("Project id"),
        itemId: z
          .string()
          .describe("Project item id (from list_projects with projectId)"),
        status: z.enum(ITEM_STATUSES).describe("New status"),
      },
      async ({ vehicleId, projectId, itemId, status }) =>
        run(async () => {
          const userId = this.requireUserId();
          const item = await updateProjectItemStatus({
            id: itemId,
            projectId,
            vehicleId,
            userId,
            status,
          });
          if (!item) throw new Error("Project item not found");
          return { id: item.id, name: item.name, status: item.status };
        }),
    );
  }
}
