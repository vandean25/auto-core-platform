import { VehiclePartyRole, type Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import { dayToDate } from './vehicle-party-date.util.js';
import { activeOnDay } from './vehicle-party.query.js';

export type VehicleOwnerMismatch = {
  vehicle_id: string;
  customer_id: string | null;
  owner_customer_id: string | null;
};

/**
 * Read-only drift check: vehicles of one tenant whose active OWNER party (on `today`,
 * `YYYY-MM-DD`) differs from `Vehicle.customer_id`. A vehicle with a main contact but no OWNER
 * party yet is listed too (`owner_customer_id` null); the read-time fallback keeps it working.
 *
 * shortcut: one query over every vehicle with a main contact or an active OWNER, compared in
 * memory (Prisma cannot compare two columns); page it by id when a tenant outgrows that.
 */
export async function findVehicleOwnerMismatches(
  db: Pick<PrismaService, 'vehicle'>,
  tenantId: string,
  today: string,
): Promise<VehicleOwnerMismatch[]> {
  const activeOwner: Prisma.VehiclePartyWhereInput = {
    tenant_id: tenantId,
    role: VehiclePartyRole.OWNER,
    ...activeOnDay(dayToDate(today) as Date),
  };
  const vehicles = await db.vehicle.findMany({
    where: {
      tenant_id: tenantId,
      OR: [{ customer_id: { not: null } }, { parties: { some: activeOwner } }],
    },
    select: {
      id: true,
      customer_id: true,
      parties: { where: activeOwner, select: { customer_id: true } },
    },
    orderBy: { id: 'asc' },
  });
  return vehicles
    .map((vehicle) => ({
      vehicle_id: vehicle.id,
      customer_id: vehicle.customer_id,
      owner_customer_id: vehicle.parties[0]?.customer_id ?? null,
    }))
    .filter((row) => row.customer_id !== row.owner_customer_id);
}
