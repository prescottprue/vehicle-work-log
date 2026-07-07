import { createId } from "@paralleldrive/cuid2";
import { type SQL, sql } from "drizzle-orm";
import {
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const cuid2 = () => text().$defaultFn(() => createId());

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const users = pgTable(
  "users",
  {
    id: cuid2().primaryKey(),
    email: text().notNull(),
    displayName: text("display_name"),
    avatarPath: text("avatar_path"),
    ...timestamps,
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const passwords = pgTable("passwords", {
  hash: text().notNull(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
});

export const mechanics = pgTable(
  "mechanics",
  {
    id: cuid2().primaryKey(),
    name: text().notNull(),
    email: text(),
    location: text().notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("mechanics_email_idx").on(t.email)],
);

export const vehicles = pgTable("vehicles", {
  id: cuid2().primaryKey(),
  name: text(),
  make: text().notNull(),
  model: text().notNull(),
  trim: text(),
  year: integer().notNull(),
  // 17-char VIN; backfilled from scanned shop receipts when missing.
  vin: text(),
  // Free-text engine description, e.g. "3.6L V6 Pentastar". Filled by the
  // vPIC VIN decode on the vehicle form, always user-editable.
  engine: text(),
  // Acquisition details. `purchasedAt` is date-only (UTC midnight from an
  // <input type="date">) — render with formatDateOnly. `seller` is the
  // dealer or private party. Owner-editable on the Documents tab; the actual
  // contract / title scans live in `vehicle_documents`.
  purchasedAt: timestamp("purchased_at", { withTimezone: true, mode: "date" }),
  purchasePrice: doublePrecision("purchase_price"),
  purchaseOdometer: doublePrecision("purchase_odometer"),
  seller: text(),
  purchaseNote: text("purchase_note"),
  avatarPath: text("avatar_path"),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
  ...timestamps,
});

export const logs = pgTable(
  "logs",
  {
    id: cuid2().primaryKey(),
    title: text().notNull(),
    notes: text(),
    // Free-form service type: one of "Minor", "Major", "Modify", "Check" in UI.
    type: text(),
    cost: doublePrecision(),
    odometer: doublePrecision(),
    // When the work began (drop-off), if known. A receipt showing a single
    // date fills only servicedAt — the close/completion date below.
    serviceStartedAt: timestamp("service_started_at", {
      withTimezone: true,
      mode: "date",
    }),
    // The service close/completion date (invoice date). System-side
    // created_at/updated_at live in `timestamps`.
    servicedAt: timestamp("serviced_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    selfService: boolean("self_service").notNull().default(false),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    vehicleId: text("vehicle_id")
      .notNull()
      .references(() => vehicles.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    mechanicId: text("mechanic_id").references(() => mechanics.id, {
      onDelete: "set null",
    }),
    searchTsv: tsvector("search_tsv").generatedAlwaysAs(
      (): SQL =>
        sql`to_tsvector('english', coalesce(${logs.title}, '') || ' ' || coalesce(${logs.notes}, ''))`,
    ),
    ...timestamps,
  },
  (t) => [
    index("logs_search_idx").using("gin", t.searchTsv),
    index("logs_vehicle_idx").on(t.vehicleId),
    index("logs_user_idx").on(t.userId),
  ],
);

// Crew: users who share access to a vehicle. The vehicle's `userId` column
// remains the owner; members get full read/write on logs, reminders, and
// projects but cannot delete the vehicle or manage the crew.
export const vehicleMembers = pgTable(
  "vehicle_members",
  {
    vehicleId: text("vehicle_id")
      .notNull()
      .references(() => vehicles.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    role: text().notNull().default("member"), // "owner" | "member"
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.vehicleId, t.userId] }),
    index("vehicle_members_user_idx").on(t.userId),
  ],
);

// Pending crew invites for emails that don't have an account yet. Claimed
// (converted to a membership) on signup; emails are stored lowercased.
export const vehicleInvites = pgTable(
  "vehicle_invites",
  {
    id: cuid2().primaryKey(),
    vehicleId: text("vehicle_id")
      .notNull()
      .references(() => vehicles.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    email: text().notNull(),
    invitedById: text("invited_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("vehicle_invites_vehicle_email_idx").on(t.vehicleId, t.email),
    index("vehicle_invites_email_idx").on(t.email),
  ],
);

// Service reminders. Due by date and/or mileage (either may be null). When
// intervalMonths/intervalMiles are set the reminder recurs: completing it
// advances the due date/miles instead of setting completedAt.
export const reminders = pgTable(
  "reminders",
  {
    id: cuid2().primaryKey(),
    vehicleId: text("vehicle_id")
      .notNull()
      .references(() => vehicles.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    title: text().notNull(),
    notes: text(),
    dueDate: timestamp("due_date", { withTimezone: true, mode: "date" }),
    dueMiles: doublePrecision("due_miles"),
    intervalMonths: integer("interval_months"),
    intervalMiles: doublePrecision("interval_miles"),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdById: text("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [index("reminders_vehicle_idx").on(t.vehicleId)],
);

// Planned work — e.g. a rally-prep build. Items track parts through a
// proposed → ordered → received → installed pipeline with prices.
export const projects = pgTable(
  "projects",
  {
    id: cuid2().primaryKey(),
    vehicleId: text("vehicle_id")
      .notNull()
      .references(() => vehicles.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    title: text().notNull(),
    description: text(),
    status: text().notNull().default("idea"), // "idea" | "planned" | "in_progress" | "done"
    targetDate: timestamp("target_date", { withTimezone: true, mode: "date" }),
    createdById: text("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [index("projects_vehicle_idx").on(t.vehicleId)],
);

export const projectItems = pgTable(
  "project_items",
  {
    id: cuid2().primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    name: text().notNull(),
    url: text(),
    price: doublePrecision(),
    quantity: integer().notNull().default(1),
    status: text().notNull().default("proposed"), // "proposed" | "ordered" | "received" | "installed"
    notes: text(),
    ...timestamps,
  },
  (t) => [index("project_items_project_idx").on(t.projectId)],
);

// Files attached to a log — primarily the original scanned shop invoice
// ingested by Scan Bay, but also phone photos or PDFs. `path` is a storage
// key (see app/storage.server.ts); `kind` distinguishes provenance.
export const logAttachments = pgTable(
  "log_attachments",
  {
    id: cuid2().primaryKey(),
    logId: text("log_id")
      .notNull()
      .references(() => logs.id, { onDelete: "cascade", onUpdate: "cascade" }),
    path: text().notNull(),
    contentType: text("content_type").notNull(),
    originalName: text("original_name"),
    kind: text().notNull().default("scan"), // "scan" | "photo" | "doc"
    ...timestamps,
  },
  (t) => [index("log_attachments_log_idx").on(t.logId)],
);

// Documents attached directly to a vehicle (not a service log): the purchase
// contract, title, registration, insurance card, bill of sale. `kind` tags
// the document (vocab in document.shared.ts); `extractedText` is OCR pulled
// from image uploads (best-effort, see transcribeImage) and feeds the
// generated `search_tsv` GIN index so crew can search words inside scans.
export const vehicleDocuments = pgTable(
  "vehicle_documents",
  {
    id: cuid2().primaryKey(),
    vehicleId: text("vehicle_id")
      .notNull()
      .references(() => vehicles.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    path: text().notNull(),
    contentType: text("content_type").notNull(),
    originalName: text("original_name"),
    kind: text().notNull().default("other"),
    // Optional human label, e.g. "2024 registration renewal".
    label: text(),
    // OCR transcription of an image document, filled on upload when a vision
    // backend is reachable. Null for PDFs and when transcription is skipped.
    extractedText: text("extracted_text"),
    uploadedById: text("uploaded_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    searchTsv: tsvector("search_tsv").generatedAlwaysAs(
      (): SQL =>
        sql`to_tsvector('english', coalesce(${vehicleDocuments.label}, '') || ' ' || coalesce(${vehicleDocuments.originalName}, '') || ' ' || coalesce(${vehicleDocuments.extractedText}, ''))`,
    ),
    ...timestamps,
  },
  (t) => [
    index("vehicle_documents_vehicle_idx").on(t.vehicleId),
    index("vehicle_documents_search_idx").using("gin", t.searchTsv),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: serial().primaryKey(),
    name: text().notNull(),
  },
  (t) => [uniqueIndex("tags_name_idx").on(t.name)],
);

export const parts = pgTable("parts", {
  id: serial().primaryKey(),
  name: text().notNull(),
  manufacturer: text().notNull(),
  price: doublePrecision().notNull(),
  link: text(),
  note: text(),
});

export const logsToTags = pgTable(
  "logs_to_tags",
  {
    logId: text("log_id")
      .notNull()
      .references(() => logs.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.logId, t.tagId] })],
);

export const logsToParts = pgTable(
  "logs_to_parts",
  {
    logId: text("log_id")
      .notNull()
      .references(() => logs.id, { onDelete: "cascade" }),
    partId: integer("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.logId, t.partId] })],
);

export const odometerReadings = pgTable(
  "odometer_readings",
  {
    id: cuid2().primaryKey(),
    odometer: doublePrecision().notNull(),
    // When the reading was taken. Date-only semantics (UTC midnight from an
    // <input type="date">) — render with formatDateOnly.
    readAt: timestamp("read_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    note: text(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    vehicleId: text("vehicle_id")
      .notNull()
      .references(() => vehicles.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    ...timestamps,
  },
  (t) => [index("odometer_readings_vehicle_idx").on(t.vehicleId)],
);

// Per-user Google Drive connection. Here Logbook is the OAuth *client* (the
// user authorizes Logbook to write into their Drive) — the opposite role from
// the MCP server, where Logbook is the OAuth provider. The `drive.file` scope
// means Logbook can only see and touch files it created itself, never the
// rest of the user's Drive. `refreshTokenEnc` is AES-GCM encrypted at rest
// (see app/google/crypto.server.ts); the access token is cached until expiry.
export const googleConnections = pgTable("google_connections", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
  // The Google account the tokens belong to, for display. Filled from the
  // OpenID `email` scope at connect time.
  googleEmail: text("google_email"),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  accessToken: text("access_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
    mode: "date",
  }),
  // The id of the "Logbook" root folder created in the user's Drive.
  rootFolderId: text("root_folder_id"),
  scope: text(),
  lastSyncedAt: timestamp("last_synced_at", {
    withTimezone: true,
    mode: "date",
  }),
  ...timestamps,
});

// Maps a synced source object to the file/folder Logbook created in the user's
// Drive, so re-syncing is idempotent and resumable: an already-synced
// immutable blob (a vehicle document or log attachment) is skipped, folders
// are reused, and the JSON export is updated in place. Rows cascade when the
// user (or their connection) is deleted.
export const driveSyncedFiles = pgTable(
  "drive_synced_files",
  {
    id: cuid2().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    // "folder" | "vehicle_document" | "log_attachment" | "export"
    sourceType: text("source_type").notNull(),
    // Stable key within sourceType: a document/attachment id, a folder path
    // like "vehicle:<id>" or "vehicle:<id>:documents", or "export".
    sourceKey: text("source_key").notNull(),
    driveFileId: text("drive_file_id").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("drive_synced_files_source_idx").on(
      t.userId,
      t.sourceType,
      t.sourceKey,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Vehicle = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;
export type Log = typeof logs.$inferSelect;
export type NewLog = typeof logs.$inferInsert;
export type Mechanic = typeof mechanics.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type Part = typeof parts.$inferSelect;
export type VehicleMember = typeof vehicleMembers.$inferSelect;
export type VehicleInvite = typeof vehicleInvites.$inferSelect;
export type Reminder = typeof reminders.$inferSelect;
export type NewReminder = typeof reminders.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ProjectItem = typeof projectItems.$inferSelect;
export type NewProjectItem = typeof projectItems.$inferInsert;
export type LogAttachment = typeof logAttachments.$inferSelect;
export type NewLogAttachment = typeof logAttachments.$inferInsert;
export type VehicleDocument = typeof vehicleDocuments.$inferSelect;
export type NewVehicleDocument = typeof vehicleDocuments.$inferInsert;
export type OdometerReading = typeof odometerReadings.$inferSelect;
export type NewOdometerReading = typeof odometerReadings.$inferInsert;
export type GoogleConnection = typeof googleConnections.$inferSelect;
export type NewGoogleConnection = typeof googleConnections.$inferInsert;
export type DriveSyncedFile = typeof driveSyncedFiles.$inferSelect;
export type NewDriveSyncedFile = typeof driveSyncedFiles.$inferInsert;
