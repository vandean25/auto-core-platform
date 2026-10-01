import { Injectable } from '@nestjs/common';
import { LocationType } from '@prisma/client';
import { SiteContextService } from '../common/services/site-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  lockActiveSiteForLocationWrites,
  softDeleteStorageLocation,
} from './location-deletion.helpers.js';
import { resolveLocationScope } from './location-hierarchy.helpers.js';
import {
  createStorageLocation,
  updateStorageLocation,
} from './location-mutation.helpers.js';
import {
  findScopedLocationBins,
  findScopedLocationChildren,
  findScopedLocations,
  type LocationTreeNode,
  toLocationTree,
} from './location-query.helpers.js';

const locationInclude = {
  parent: true,
  _count: {
    select: { children: true, stocks: true },
  },
} as const;

@Injectable()
export class LocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  async findAll() {
    const scope = await resolveLocationScope(
      this.tenantContext,
      this.siteContext,
    );
    return findScopedLocations(this.prisma, scope, locationInclude);
  }

  async getTree(): Promise<LocationTreeNode[]> {
    return toLocationTree(await this.findAll());
  }

  async getChildren(parentId: string) {
    const scope = await resolveLocationScope(
      this.tenantContext,
      this.siteContext,
    );
    return findScopedLocationChildren(this.prisma, scope, parentId);
  }

  async getBins() {
    const scope = await resolveLocationScope(
      this.tenantContext,
      this.siteContext,
    );
    return findScopedLocationBins(this.prisma, scope);
  }

  async create(data: {
    name: string;
    code: string;
    type: LocationType;
    parentId?: string;
  }) {
    const scope = await resolveLocationScope(
      this.tenantContext,
      this.siteContext,
    );
    return createStorageLocation(this.prisma, scope, data);
  }

  async update(
    id: string,
    data: {
      name?: string;
      code?: string;
      type?: LocationType;
      parentId?: string;
    },
  ) {
    const scope = await resolveLocationScope(
      this.tenantContext,
      this.siteContext,
    );
    return updateStorageLocation(this.prisma, scope, id, data);
  }

  async remove(id: string) {
    const scope = await resolveLocationScope(
      this.tenantContext,
      this.siteContext,
    );
    return this.prisma.$transaction(async (tx) => {
      await lockActiveSiteForLocationWrites(tx, scope);
      return softDeleteStorageLocation(tx, id, scope, locationInclude);
    });
  }
}
