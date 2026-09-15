import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LocationType, Prisma } from '@prisma/client';
import { SiteContextService } from '../common/services/site-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const locationInclude = {
  parent: true,
  _count: {
    select: { children: true, stocks: true },
  },
} as const;

type LocationWithRelations = Prisma.StorageLocationGetPayload<{
  include: typeof locationInclude;
}>;

type LocationScope = {
  tenantId: string;
  siteId: string;
};

type LocationTreeNode = LocationWithRelations & {
  children: LocationTreeNode[];
};

@Injectable()
export class LocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  async findAll(): Promise<LocationWithRelations[]> {
    const scope = await this.getLocationScope();
    return this.prisma.storageLocation.findMany({
      where: this.listWhere(scope),
      orderBy: { name: 'asc' },
      include: locationInclude,
    });
  }

  async getTree(): Promise<LocationTreeNode[]> {
    return this.buildTree(await this.findAll());
  }

  async getChildren(parentId: string) {
    const scope = await this.getLocationScope();
    return this.prisma.storageLocation.findMany({
      where: { ...this.listWhere(scope), parent_id: parentId },
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { children: true, stocks: true },
        },
      },
    });
  }

  async getBins() {
    const scope = await this.getLocationScope();
    return this.prisma.storageLocation.findMany({
      where: { ...this.listWhere(scope), type: LocationType.bin },
      orderBy: { name: 'asc' },
      include: { parent: true },
    });
  }

  async create(data: {
    name: string;
    code: string;
    type: LocationType;
    parentId?: string;
  }) {
    const scope = await this.getLocationScope();
    await this.validateHierarchy(data.type, data.parentId, scope);

    const existingCode = await this.prisma.storageLocation.findFirst({
      where: {
        tenant_id: scope.tenantId,
        site_id: scope.siteId,
        code: data.code,
      },
    });
    if (existingCode) {
      throw new BadRequestException('Location code must be unique per site');
    }

    return this.prisma.storageLocation.create({
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

  async update(
    id: string,
    data: {
      name?: string;
      code?: string;
      type?: LocationType;
      parentId?: string;
    },
  ) {
    const scope = await this.getLocationScope();
    const location = await this.prisma.storageLocation.findFirst({
      where: { id, tenant_id: scope.tenantId, site_id: scope.siteId },
    });
    if (!location) {
      throw new NotFoundException('Location not found');
    }

    if (data.code && data.code !== location.code) {
      const existing = await this.prisma.storageLocation.findFirst({
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
      await this.validateHierarchy(type, parentId, scope);
    }

    await this.prisma.storageLocation.updateMany({
      where: { id, tenant_id: scope.tenantId, site_id: scope.siteId },
      data: {
        name: data.name,
        code: data.code,
        type: data.type,
        parent_id: data.parentId,
      },
    });

    const updated = await this.prisma.storageLocation.findFirst({
      where: { id, tenant_id: scope.tenantId, site_id: scope.siteId },
    });
    if (!updated) {
      throw new NotFoundException('Location not found');
    }
    return updated;
  }

  async remove(id: string) {
    const scope = await this.getLocationScope();
    return this.prisma.$transaction(async (tx) => {
      await this.lockActiveSite(tx, scope);
      return this.softDeleteLocation(tx, id, scope);
    });
  }

  private async softDeleteLocation(
    tx: Prisma.TransactionClient,
    id: string,
    scope: LocationScope,
  ) {
    const location = await tx.storageLocation.findFirst({
      where: { id, tenant_id: scope.tenantId, site_id: scope.siteId },
      include: { _count: { select: { children: true, stocks: true } } },
    });
    if (!location) {
      throw new NotFoundException('Location not found');
    }
    if (location.is_system) {
      throw new ConflictException('System locations cannot be deleted');
    }
    if (location._count.children > 0) {
      throw new BadRequestException(
        'Cannot delete location with children. Delete children first.',
      );
    }
    if (location._count.stocks > 0) {
      throw new BadRequestException('Cannot delete location containing stock.');
    }

    const parkedVehicles = await tx.vehicle.count({
      where: {
        tenant_id: scope.tenantId,
        location_id: id,
        inventory_role: { in: ['USED', 'NEW', 'DEMO'] },
        stock_status: { in: ['IN_STOCK', 'RESERVED', 'IN_PREP'] },
      },
    });
    if (parkedVehicles > 0) {
      throw new ConflictException(
        'Cannot delete or disable a lot with parked dealer vehicles. Move or sell the vehicles first.',
      );
    }

    const openTransferLines = await tx.stockTransferLine.findMany({
      where: {
        tenant_id: scope.tenantId,
        transfer: { status: { in: ['REQUESTED', 'APPROVED', 'SHIPPED'] } },
        OR: [
          { from_site_id: scope.siteId, source_location_id: id },
          { to_site_id: scope.siteId, dest_location_id: id },
        ],
      },
      select: {
        source_location_id: true,
        dest_location_id: true,
        approved_qty: true,
        shipped_qty: true,
        received_qty: true,
        returned_qty: true,
      },
    });
    const hasOutstandingTransferQty = openTransferLines.some((line) => {
      const outstanding = line.shipped_qty.minus(
        line.received_qty.plus(line.returned_qty),
      );
      if (line.source_location_id === id) {
        // Frozen future pick or remaining in-transit qty from this bin.
        if (line.approved_qty.gt(0) || outstanding.gt(0)) {
          return true;
        }
      }
      if (line.dest_location_id === id && outstanding.gt(0)) {
        return true;
      }
      return false;
    });
    if (hasOutstandingTransferQty) {
      throw new ConflictException(
        'Cannot delete or disable a location referenced by a stock transfer with outstanding quantity.',
      );
    }

    await tx.storageLocation.updateMany({
      where: { id, tenant_id: scope.tenantId, site_id: scope.siteId },
      data: { deletedAt: new Date() },
    });

    const updated = await tx.storageLocation.findFirst({
      where: { id, tenant_id: scope.tenantId, site_id: scope.siteId },
      include: locationInclude,
    });
    if (!updated) {
      throw new NotFoundException('Location not found');
    }
    return updated;
  }

  private async lockActiveSite(
    tx: Prisma.TransactionClient,
    scope: LocationScope,
  ): Promise<void> {
    // eslint-disable-next-line no-restricted-syntax -- ADR-0021/0022 site-row lock serializes location deactivation with transfer writes.
    await tx.$queryRaw`
      SELECT id
      FROM "sites"
      WHERE tenant_id = ${scope.tenantId}
        AND id = ${scope.siteId}
      ORDER BY id
      FOR UPDATE
    `;
  }

  private async validateHierarchy(
    type: LocationType,
    parentId: string | null | undefined,
    scope: LocationScope,
  ): Promise<void> {
    if (type === LocationType.warehouse) {
      if (parentId) {
        throw new BadRequestException(
          'Warehouses cannot have a parent location',
        );
      }
      return;
    }
    if (!parentId) {
      throw new BadRequestException(`${type} must have a parent location`);
    }

    const parent = await this.prisma.storageLocation.findFirst({
      where: {
        id: parentId,
        tenant_id: scope.tenantId,
        site_id: scope.siteId,
      },
    });
    if (!parent) {
      throw new NotFoundException('Parent location not found');
    }

    const allowedParents: Record<LocationType, readonly LocationType[]> = {
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
    if (!allowedParents[type].includes(parent.type)) {
      throw new BadRequestException(
        `Location of type ${type} cannot be child of ${parent.type}.`,
      );
    }
  }

  private async getLocationScope(): Promise<LocationScope> {
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    return { tenantId, siteId };
  }

  private listWhere(scope: LocationScope): Prisma.StorageLocationWhereInput {
    return {
      tenant_id: scope.tenantId,
      site_id: scope.siteId,
      is_system: false,
      deletedAt: null,
    };
  }

  private buildTree(
    locations: LocationWithRelations[],
    parentId: string | null = null,
  ): LocationTreeNode[] {
    return locations
      .filter((location) => location.parent_id === parentId)
      .map((location) => ({
        ...location,
        children: this.buildTree(locations, location.id),
      }));
  }
}
