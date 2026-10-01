import { LocationType, Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { LocationScope } from './location-hierarchy.helpers.js';

const listWhere = (scope: LocationScope): Prisma.StorageLocationWhereInput => ({
  tenant_id: scope.tenantId,
  site_id: scope.siteId,
  is_system: false,
  deletedAt: null,
});

export type LocationListItem = Prisma.StorageLocationGetPayload<{
  include: {
    parent: true;
    _count: { select: { children: true; stocks: true } };
  };
}>;

export type LocationTreeNode = LocationListItem & {
  children: LocationTreeNode[];
};

export function toLocationTree(
  locations: LocationListItem[],
  parentId: string | null = null,
): LocationTreeNode[] {
  return locations
    .filter((location) => location.parent_id === parentId)
    .map((location) => ({
      ...location,
      children: toLocationTree(locations, location.id),
    }));
}

export async function findScopedLocations<
  TInclude extends Prisma.StorageLocationInclude,
>(prisma: PrismaService, scope: LocationScope, include: TInclude) {
  return prisma.storageLocation.findMany({
    where: listWhere(scope),
    orderBy: { name: 'asc' },
    include,
  });
}

export async function findScopedLocationChildren(
  prisma: PrismaService,
  scope: LocationScope,
  parentId: string,
) {
  return prisma.storageLocation.findMany({
    where: { ...listWhere(scope), parent_id: parentId },
    orderBy: { name: 'asc' },
    include: {
      _count: {
        select: { children: true, stocks: true },
      },
    },
  });
}

export async function findScopedLocationBins(
  prisma: PrismaService,
  scope: LocationScope,
) {
  return prisma.storageLocation.findMany({
    where: { ...listWhere(scope), type: LocationType.bin },
    orderBy: { name: 'asc' },
    include: { parent: true },
  });
}
