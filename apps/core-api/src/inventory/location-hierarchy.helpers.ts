import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LocationType, Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';

export type LocationScope = {
  tenantId: string;
  siteId: string;
};

export async function resolveLocationScope(
  tenantContext: { getTenantId(): Promise<string> },
  siteContext: { getSiteId(): Promise<string> },
): Promise<LocationScope> {
  const [tenantId, siteId] = await Promise.all([
    tenantContext.getTenantId(),
    siteContext.getSiteId(),
  ]);
  return { tenantId, siteId };
}

const ALLOWED_PARENT_TYPES: Readonly<
  Record<LocationType, readonly LocationType[]>
> = {
  [LocationType.warehouse]: [],
  [LocationType.aisle]: [LocationType.warehouse],
  [LocationType.shelf]: [LocationType.aisle, LocationType.warehouse],
  [LocationType.bin]: [
    LocationType.shelf,
    LocationType.aisle,
    LocationType.warehouse,
  ],
  [LocationType.customer_storage]: [LocationType.warehouse],
  [LocationType.staging_tote]: [LocationType.warehouse],
  [LocationType.vehicle_lot]: [LocationType.warehouse],
  [LocationType.in_transit]: [],
};

export async function validateLocationHierarchy(
  prisma: PrismaService | Prisma.TransactionClient,
  type: LocationType,
  parentId: string | null | undefined,
  scope: LocationScope,
): Promise<void> {
  if (type === LocationType.warehouse) {
    if (parentId) {
      throw new BadRequestException('Warehouses cannot have a parent location');
    }
    return;
  }
  if (!parentId) {
    throw new BadRequestException(`${type} must have a parent location`);
  }

  const parent = await prisma.storageLocation.findFirst({
    where: {
      id: parentId,
      tenant_id: scope.tenantId,
      site_id: scope.siteId,
    },
  });
  if (!parent) {
    throw new NotFoundException('Parent location not found');
  }

  if (!ALLOWED_PARENT_TYPES[type].includes(parent.type)) {
    throw new BadRequestException(
      `Location of type ${type} cannot be child of ${parent.type}.`,
    );
  }
}
