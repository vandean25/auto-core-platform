import { InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SideEffectGuard } from '../../dry-run/side-effect-guard.js';
import { getVehicleMediaPurgeStorage } from './vehicle-media-purge.registry.js';
import type { VehicleMediaStorage } from './vehicle-media.storage.js';

export type VehicleWhere = {
  id?: string;
  tenant_id?: string;
  AND?: VehicleWhere[];
  OR?: VehicleWhere[];
};

type VehicleFindManyDelegate = {
  findMany: (args: {
    where?: VehicleWhere;
    select: { id: true; tenant_id: true };
  }) => Promise<Array<{ id: string; tenant_id: string }>>;
  findFirst: (args: {
    where: { id: string; tenant_id: string };
    select: { id: true };
  }) => Promise<{ id: string } | null>;
};

export function requireVehicleMediaPurgeStorage(): VehicleMediaStorage {
  const storage = getVehicleMediaPurgeStorage();
  if (!storage) {
    throw new InternalServerErrorException(
      'Vehicle photo purge storage is not registered.',
    );
  }
  return storage;
}

export async function purgeVehicleMediaPrefixes(
  vehicles: Array<{ id: string; tenant_id: string }>,
): Promise<void> {
  if (vehicles.length === 0) {
    return;
  }
  const storage = requireVehicleMediaPurgeStorage();
  for (const vehicle of vehicles) {
    await storage.deleteVehicleMediaPrefix({
      tenantId: vehicle.tenant_id,
      vehicleId: vehicle.id,
    });
  }
}

export async function vehiclesDeletedBySuccessfulBatchDelete(
  vehicleDelegate: VehicleFindManyDelegate,
  candidates: Array<{ id: string; tenant_id: string }>,
): Promise<Array<{ id: string; tenant_id: string }>> {
  const deleted: Array<{ id: string; tenant_id: string }> = [];
  for (const vehicle of candidates) {
    const stillExists = await vehicleDelegate.findFirst({
      where: { id: vehicle.id, tenant_id: vehicle.tenant_id },
      select: { id: true },
    });
    if (!stillExists) {
      deleted.push(vehicle);
    }
  }
  return deleted;
}

export async function runVehicleDeleteManyWithMediaPurge(
  vehicleDelegate: VehicleFindManyDelegate,
  where: VehicleWhere | undefined,
  query: () => Promise<{ count: number }>,
): Promise<{ count: number }> {
  if (SideEffectGuard.isDryRun()) {
    return query();
  }
  const candidates = await vehicleDelegate.findMany({
    where: where ?? {},
    select: { id: true, tenant_id: true },
  });
  const result = await query();
  if (result.count === 0) {
    return result;
  }
  const deleted = await vehiclesDeletedBySuccessfulBatchDelete(
    vehicleDelegate,
    candidates,
  );
  await purgeVehicleMediaPrefixes(deleted);
  return result;
}

export async function runVehicleDeleteWithMediaPurge(
  vehicleDelegate: VehicleFindManyDelegate,
  where: VehicleWhere | undefined,
  query: () => Promise<unknown>,
): Promise<unknown> {
  if (SideEffectGuard.isDryRun()) {
    return query();
  }
  const candidates = await vehicleDelegate.findMany({
    where: where ?? {},
    select: { id: true, tenant_id: true },
  });
  const result = await query();
  const deleted = await vehiclesDeletedBySuccessfulBatchDelete(
    vehicleDelegate,
    candidates,
  );
  await purgeVehicleMediaPrefixes(deleted);
  return result;
}

export function createVehicleMediaPurgeExtension() {
  return Prisma.defineExtension((client) =>
    client.$extends({
      name: 'vehicle-media-purge',
      query: {
        vehicle: {
          async delete({ args, query }) {
            return runVehicleDeleteWithMediaPurge(
              client.vehicle,
              args.where,
              () => query(args),
            );
          },
          async deleteMany({ args, query }) {
            return runVehicleDeleteManyWithMediaPurge(
              client.vehicle,
              args.where,
              () => query(args),
            );
          },
        },
      },
    }),
  );
}
