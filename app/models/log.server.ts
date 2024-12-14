import type { User, Log, Vehicle, Mechanic, Part, Tag, Prisma } from "@prisma/client";

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

export async function createLog({
  title,
  notes,
  type,
  cost,
  odometer,
  servicedAt,
  selfService,
  userId,
  vehicleId,
  mechanicId,
  parts,
  tags,
}: Pick<
  Log,
  "title" | "notes" | "type" | "cost" | "odometer" | "servicedAt" | "selfService"
> & {
  userId: User["id"];
  vehicleId: Vehicle["id"];
  mechanicId?: Mechanic["id"];
  tags?: Tag[],
  parts?: Part[],
}) {
  const newTags = tags?.filter(tag => !tag.id)
  const newParts = parts?.filter(part => !part.id)
  const newLog = await prisma.log.create({
    data: {
      title,
      notes,
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
      parts: newParts?.length ? { create: newParts } : undefined,
      tags: newTags?.length ? { create: newTags } : undefined
    },
  });

  // Update new log with tags/parts which already exist
  const existingTags = tags?.filter(tag => tag.id)
  const existingParts = parts?.filter(part => part.id)
  if (existingTags?.length || existingParts?.length) {
    await prisma.log.update({
      where: {
        id: newLog.id
      },
      data: {
        tags: existingTags?.length ? { set: existingTags.map((tag) => ({ id: tag.id })) } : undefined,
        parts: existingParts?.length ? { set: existingParts.map((tag) => ({ id: tag.id })) } : undefined,
      }
    })
  }
  return newLog
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
