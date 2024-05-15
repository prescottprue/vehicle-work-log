import type { User, Vehicle } from "@prisma/client";

import { prisma } from "~/db.server";

export type { Vehicle } from "@prisma/client";

export function getVehicle({
  id,
  userId,
}: Pick<Vehicle, "id"> & {
  userId: User["id"];
}) {
  return prisma.vehicle.findFirst({
    where: { id, userId },
  });
}

export function getVehicleListItems({ userId }: { userId: User["id"] }) {
  return prisma.vehicle.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
}

export function createVehicle({
  name,
  make,
  model,
  year,
  userId,
  avatarPath
}: Pick<Vehicle, "name" | "make" | "model" | "year" | "avatarPath"> & {
  userId: User["id"];
}) {
  return prisma.vehicle.create({
    data: {
      name,
      make,
      model,
      year,
      avatarPath,
      user: {
        connect: {
          id: userId,
        },
      },
    },
  });
}

export function deleteVehicle({
  id,
  userId,
}: Pick<Vehicle, "id"> & { userId: User["id"] }) {
  return prisma.vehicle.deleteMany({
    where: { id, userId },
  });
}
