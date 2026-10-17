import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { getVehicleMediaPurgeStorage } from './vehicle-media-purge.registry.js';

type VehicleWhere = {
  id?: string;
  tenant_id?: string;
  AND?: VehicleWhere[];
  OR?: VehicleWhere[];
};

async function purgeMediaForVehicleWhere(
  client: Pick<PrismaService, 'vehicle'>,
  where: VehicleWhere | undefined,
): Promise<void> {
  const storage = getVehicleMediaPurgeStorage();
  if (!storage) {
    return;
  }
  const vehicles = await client.vehicle.findMany({
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
  return Prisma.defineExtension({
    name: 'vehicle-media-purge',
    query: {
      vehicle: {
        async delete({ args, query }) {
          const client = Prisma.getExtensionContext(this) as Pick<
            PrismaService,
            'vehicle'
          >;
          await purgeMediaForVehicleWhere(client, args.where as VehicleWhere);
          return query(args);
        },
        async deleteMany({ args, query }) {
          const client = Prisma.getExtensionContext(this) as Pick<
            PrismaService,
            'vehicle'
          >;
          await purgeMediaForVehicleWhere(client, args.where as VehicleWhere);
          return query(args);
        },
      },
    },
  });
}
