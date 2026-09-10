import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEALER_INVENTORY_ROLES,
  DEALER_STOCK_STATUSES,
  SYSTEM_LOCATION_CODE,
  SYSTEM_LOCATION_TYPE,
} from './site.constants';

export async function createSitePrerequisites(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  openingHours: readonly {
    weekday: number;
    isClosed: boolean;
    openTime: string;
    closeTime: string;
  }[],
): Promise<void> {
  await tx.workshopOpeningHour.createMany({
    data: openingHours.map((hour) => ({
      tenant_id: tenantId,
      site_id: siteId,
      weekday: hour.weekday,
      is_closed: hour.isClosed,
      open_time: hour.openTime,
      close_time: hour.closeTime,
    })),
    skipDuplicates: true,
  });
  await tx.storageLocation.create({
    data: {
      tenant_id: tenantId,
      site_id: siteId,
      code: SYSTEM_LOCATION_CODE,
      name: 'In Transit',
      type: SYSTEM_LOCATION_TYPE,
      is_system: true,
    },
  });
}

export async function deleteSitePrerequisites(
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  hasOnlySystemTransit: boolean,
): Promise<void> {
  if (hasOnlySystemTransit) {
    await tx.storageLocation.deleteMany({
      where: {
        tenant_id: tenantId,
        site_id: siteId,
        is_system: true,
        type: SYSTEM_LOCATION_TYPE,
      },
    });
  }
  // Pristine-site hard delete removes its hours/holiday config internally.
  await tx.workshopOpeningHour.deleteMany({
    where: { tenant_id: tenantId, site_id: siteId },
  });
  await tx.workshopHoliday.deleteMany({
    where: { tenant_id: tenantId, site_id: siteId },
  });
  await tx.site.delete({ where: { id: siteId } });
}

export async function countParkedVehicles(
  prisma: PrismaService | Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
): Promise<number> {
  return prisma.vehicle.count({
    where: {
      tenant_id: tenantId,
      inventory_role: { in: [...DEALER_INVENTORY_ROLES] },
      stock_status: { in: [...DEALER_STOCK_STATUSES] },
      location: { site_id: siteId },
    },
  });
}

export function isForeignKeyViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2003'
  );
}
