import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LocationType, type StorageLocation } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  type LocationScope,
  validateLocationHierarchy,
} from './location-hierarchy.helpers.js';

export async function createStorageLocation(
  prisma: PrismaService,
  scope: LocationScope,
  data: {
    name: string;
    code: string;
    type: LocationType;
    parentId?: string;
  },
) {
  await validateLocationHierarchy(prisma, data.type, data.parentId, scope);

  const existingCode = await prisma.storageLocation.findFirst({
    where: {
      tenant_id: scope.tenantId,
      site_id: scope.siteId,
      code: data.code,
    },
  });
  if (existingCode) {
    throw new BadRequestException('Location code must be unique per site');
  }

  return prisma.storageLocation.create({
    data: {
      tenant_id: scope.tenantId,
      site_id: scope.siteId,
      name: data.name,
      code: data.code,
      type: data.type,
      parent_id: data.parentId,
    },
  });
}

export async function updateStorageLocation(
  prisma: PrismaService,
  scope: LocationScope,
  id: string,
  data: {
    name?: string;
    code?: string;
    type?: LocationType;
    parentId?: string;
  },
) {
  const location = await prisma.storageLocation.findFirst({
    where: { id, tenant_id: scope.tenantId, site_id: scope.siteId },
  });
  if (!location) {
    throw new NotFoundException('Location not found');
  }

  await validateLocationUpdatePayload(prisma, scope, id, data, location);

  await prisma.storageLocation.updateMany({
    where: { id, tenant_id: scope.tenantId, site_id: scope.siteId },
    data: {
      name: data.name,
      code: data.code,
      type: data.type,
      parent_id: data.parentId,
    },
  });

  const updated = await prisma.storageLocation.findFirst({
    where: { id, tenant_id: scope.tenantId, site_id: scope.siteId },
  });
  if (!updated) {
    throw new NotFoundException('Location not found');
  }
  return updated;
}

async function validateLocationUpdatePayload(
  prisma: PrismaService,
  scope: LocationScope,
  id: string,
  data: {
    name?: string;
    code?: string;
    type?: LocationType;
    parentId?: string;
  },
  location: StorageLocation,
): Promise<void> {
  if (data.code && data.code !== location.code) {
    const existing = await prisma.storageLocation.findFirst({
      where: {
        tenant_id: scope.tenantId,
        site_id: scope.siteId,
        code: data.code,
      },
    });
    if (existing) {
      throw new BadRequestException('Code already in use at this site');
    }
  }

  if (data.type || data.parentId !== undefined) {
    const type = data.type ?? location.type;
    const parentId = data.parentId ?? location.parent_id;
    if (parentId === id) {
      throw new BadRequestException('Cannot set location as its own parent');
    }
    await validateLocationHierarchy(prisma, type, parentId, scope);
  }
}
