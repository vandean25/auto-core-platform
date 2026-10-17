import { AsyncLocalStorage } from 'node:async_hooks';
import { InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SideEffectGuard } from '../../dry-run/side-effect-guard.js';
import { getVehicleMediaPurgeStorage } from './vehicle-media-purge.registry.js';
import type { VehicleMediaStorage } from './vehicle-media.storage.js';

export type VehicleWhere = Prisma.VehicleWhereInput;

export type VehiclePurgeTarget = { id: string; tenant_id: string };

type VehicleFindManyDelegate = {
  findMany: (args: {
    where?: VehicleWhere;
    select: { id: true; tenant_id: true };
  }) => Promise<VehiclePurgeTarget[]>;
  findFirst: (args: {
    where: { id: string; tenant_id: string };
    select: { id: true };
  }) => Promise<{ id: string } | null>;
};

const pendingVehicleMediaPurges = new AsyncLocalStorage<VehiclePurgeTarget[]>();

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
  vehicles: VehiclePurgeTarget[],
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

export async function runWithDeferredVehicleMediaPurges<T>(
  work: () => Promise<T>,
): Promise<T> {
  const parentPending = pendingVehicleMediaPurges.getStore();
  if (parentPending) {
    return work();
  }
  const pending: VehiclePurgeTarget[] = [];
  return pendingVehicleMediaPurges.run(pending, async () => {
    try {
      const result = await work();
      await flushPendingVehicleMediaPurges(pending);
      return result;
    } catch (error) {
      pending.length = 0;
      throw error;
    }
  });
}

export async function flushPendingVehicleMediaPurges(
  pending: VehiclePurgeTarget[],
): Promise<void> {
  if (pending.length === 0) {
    return;
  }
  if (SideEffectGuard.isDryRun()) {
    pending.length = 0;
    return;
  }
  const targets = [...pending];
  pending.length = 0;
  await purgeVehicleMediaPrefixes(targets);
}

export async function scheduleVehicleMediaPrefixPurges(
  vehicles: VehiclePurgeTarget[],
): Promise<void> {
  if (vehicles.length === 0) {
    return;
  }
  const pending = pendingVehicleMediaPurges.getStore();
  if (pending) {
    pending.push(...vehicles);
    return;
  }
  await purgeVehicleMediaPrefixes(vehicles);
}

export async function vehiclesDeletedBySuccessfulBatchDelete(
  vehicleDelegate: VehicleFindManyDelegate,
  candidates: VehiclePurgeTarget[],
): Promise<VehiclePurgeTarget[]> {
  const deleted: VehiclePurgeTarget[] = [];
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

export function resolveVehiclesToPurgeAfterDeleteMany(
  candidates: VehiclePurgeTarget[],
  deletedCount: number,
  vehicleDelegate: VehicleFindManyDelegate,
): Promise<VehiclePurgeTarget[]> {
  if (deletedCount === 0) {
    return Promise.resolve([]);
  }
  if (deletedCount === candidates.length) {
    return Promise.resolve(candidates);
  }
  return vehiclesDeletedBySuccessfulBatchDelete(vehicleDelegate, candidates);
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
  requireVehicleMediaPurgeStorage();
  const result = await query();
  const toPurge = await resolveVehiclesToPurgeAfterDeleteMany(
    candidates,
    result.count,
    vehicleDelegate,
  );
  await scheduleVehicleMediaPrefixPurges(toPurge);
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
  requireVehicleMediaPurgeStorage();
  const result = await query();
  await scheduleVehicleMediaPrefixPurges(candidates);
  return result;
}

function resolveVehicleDelegate(
  extensionThis: unknown,
  rootClient: { vehicle: VehicleFindManyDelegate },
): VehicleFindManyDelegate {
  const extensionContext = Prisma.getExtensionContext(
    extensionThis,
  ) as unknown as Record<string, unknown>;
  if (typeof extensionContext.findMany === 'function') {
    return extensionContext as VehicleFindManyDelegate;
  }
  const nestedVehicle = extensionContext.vehicle;
  if (
    nestedVehicle &&
    typeof nestedVehicle === 'object' &&
    typeof (nestedVehicle as VehicleFindManyDelegate).findMany === 'function'
  ) {
    return nestedVehicle as VehicleFindManyDelegate;
  }
  return rootClient.vehicle;
}

type InteractiveTransactionFn = (
  client: Prisma.TransactionClient,
) => Promise<unknown>;

/** Apply after audit/realtime extensions so interactive tx clients keep their hooks. */
export function createVehicleMediaPurgeTransactionExtension() {
  return Prisma.defineExtension((client) => {
    const runTransaction = client.$transaction.bind(client);
    return client.$extends({
      name: 'vehicle-media-purge-transaction',
      client: {
        $transaction(arg: unknown, options?: unknown): Promise<unknown> {
          if (typeof arg === 'function') {
            return runWithDeferredVehicleMediaPurges(() =>
              runTransaction(arg as InteractiveTransactionFn, options),
            );
          }
          if (Array.isArray(arg)) {
            return runWithDeferredVehicleMediaPurges(() =>
              runTransaction(arg, options),
            );
          }
          return runTransaction(arg as never, options as never);
        },
      },
    });
  });
}

export function createVehicleMediaPurgeExtension() {
  return Prisma.defineExtension((client) =>
    client.$extends({
      name: 'vehicle-media-purge',
      query: {
        vehicle: {
          async delete({ args, query }) {
            const vehicleDelegate = resolveVehicleDelegate(this, client);
            return runVehicleDeleteWithMediaPurge(
              vehicleDelegate,
              args.where,
              () => query(args),
            );
          },
          async deleteMany({ args, query }) {
            const vehicleDelegate = resolveVehicleDelegate(this, client);
            return runVehicleDeleteManyWithMediaPurge(
              vehicleDelegate,
              args.where,
              () => query(args),
            );
          },
        },
      },
    }),
  );
}
