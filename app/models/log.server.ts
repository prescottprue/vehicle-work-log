import type { User, Log, Vehicle, Mechanic } from "@prisma/client";

import { prisma } from "~/db.server";

export type { Log } from "@prisma/client";

export function getLog({
  id,
  userId,
  vehicleId,
}: Pick<Log, "id"> & {
  userId: User["id"];
  vehicleId: Vehicle["id"];
}) {
  return prisma.log.findFirst({
    where: { id, userId, vehicleId },
  });
}

export function getLogListItems({
  userId,
  vehicleId,
}: {
  userId: User["id"];
  vehicleId: Vehicle["id"];
}) {
  return prisma.log.findMany({
    where: { userId, vehicleId },
    orderBy: { updatedAt: "desc" },
  });
}

export function createLog({
  title,
  body,
  type,
  cost,
  odometer,
  servicedAt,
  selfService,
  userId,
  vehicleId,
  mechanicId,
}: Pick<
  Log,
  "title" | "body" | "type" | "cost" | "odometer" | "servicedAt" | "selfService"
> & {
  userId: User["id"];
  vehicleId: Vehicle["id"];
  mechanicId?: Mechanic["id"];
}) {
  // TODO: Add tags
  return prisma.log.create({
    data: {
      title,
      body,
      type,
      cost,
      odometer,
      servicedAt,
      selfService,
      user: {
        connect: {
          id: userId,
        },
      },
      mechanic: mechanicId
        ? {
            connect: {
              id: mechanicId,
            },
          }
        : undefined,
      vehicle: {
        connect: {
          id: vehicleId,
        },
      },
    },
  });
}

export function deleteLog({
  id,
  userId,
  vehicleId,
}: Pick<Log, "id"> & { userId: User["id"]; vehicleId: Vehicle["id"] }) {
  return prisma.log.deleteMany({
    where: { id, userId, vehicleId },
  });
}
