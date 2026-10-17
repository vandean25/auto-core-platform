import { Prisma } from '@prisma/client';
import { SideEffectGuard } from '../../dry-run/side-effect-guard.js';
import { getVehicleMediaPurgeStorage } from './vehicle-media-purge.registry.js';

type VehicleWhere = {
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
};

async function purgeMediaForVehicleWhere(
  vehicleDelegate: VehicleFindManyDelegate,
  where: VehicleWhere | undefined,
): Promise<void> {
  if (SideEffectGuard.isDryRun()) {
    return;
  }
  const storage = getVehicleMediaPurgeStorage();
  if (!storage) {
    return;
  }
  const vehicles = await vehicleDelegate.findMany({
    where: where ?? {},
    select: { id: true, tenant_id: true },
  });
  for (const vehicle of vehicles) {
    await storage.deleteVehicleMediaPrefix({
      tenantId: vehicle.tenant_id,
      vehicleId: vehicle.id,
    });
  }
}

export function createVehicleMediaPurgeExtension() {
  return Prisma.defineExtension((client) =>
    client.$extends({
      name: 'vehicle-media-purge',
      query: {
        vehicle: {
          async delete({ args, query }) {
            await purgeMediaForVehicleWhere(
              client.vehicle,
              args.where as VehicleWhere,
            );
            return query(args);
          },
          async deleteMany({ args, query }) {
            await purgeMediaForVehicleWhere(
              client.vehicle,
              args.where as VehicleWhere,
            );
            return query(args);
          },
        },
      },
    }),
  );
}
