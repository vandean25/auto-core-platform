import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LocationType } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service';

@Injectable()
export class LocationService {
  constructor(
    private prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async findAll() {
    const tenantId = await this.tenantContext.getTenantId();
    return this.prisma.storageLocation.findMany({
      where: { tenant_id: tenantId, deletedAt: null },
      orderBy: { name: 'asc' },
      include: {
        parent: true,
        _count: {
          select: { children: true, stocks: true },
        },
      },
    });
  }

  async getTree() {
    const locations = await this.findAll();
    return this.buildTree(locations);
  }

  async getChildren(parentId: string) {
    const tenantId = await this.tenantContext.getTenantId();
    return this.prisma.storageLocation.findMany({
      where: { tenant_id: tenantId, parent_id: parentId, deletedAt: null },
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { children: true, stocks: true },
        },
      },
    });
  }

  async getBins() {
    const tenantId = await this.tenantContext.getTenantId();
    return this.prisma.storageLocation.findMany({
      where: { tenant_id: tenantId, type: 'bin', deletedAt: null },
      orderBy: { name: 'asc' },
      include: { parent: true },
    });
  }

  private buildTree(locations: any[], parentId: string | null = null): any[] {
    return locations
      .filter((loc) => loc.parent_id === parentId)
      .map((loc) => ({
        ...loc,
        children: this.buildTree(locations, loc.id),
      }));
  }

  async create(data: {
    name: string;
    code: string;
    type: LocationType;
    parentId?: string;
  }) {
    const tenantId = await this.tenantContext.getTenantId();
    // Validation
    await this.validateHierarchy(data.type, data.parentId);

    const existingCode = await this.prisma.storageLocation.findFirst({
      where: { tenant_id: tenantId, code: data.code },
    });
    if (existingCode) {
      throw new BadRequestException('Location code must be unique');
    }

    return this.prisma.storageLocation.create({
      data: {
        tenant_id: tenantId,
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
    const tenantId = await this.tenantContext.getTenantId();
    const location = await this.prisma.storageLocation.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!location) throw new NotFoundException('Location not found');

    if (data.code && data.code !== location.code) {
      const existing = await this.prisma.storageLocation.findFirst({
        where: { tenant_id: tenantId, code: data.code },
      });
      if (existing) throw new BadRequestException('Code already in use');
    }

    // If moving or changing type, validate hierarchy
    if (data.type || data.parentId !== undefined) {
      const newType = data.type || location.type;
      const newParentId =
        data.parentId !== undefined ? data.parentId : location.parent_id;

      // Prevent self-parenting
      if (newParentId === id)
        throw new BadRequestException('Cannot set location as its own parent');

      await this.validateHierarchy(newType, newParentId);
    }

    return this.prisma.storageLocation.update({
      where: { id },
      data: {
        name: data.name,
        code: data.code,
        type: data.type,
        parent_id: data.parentId,
      },
    });
  }

  async remove(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const location = await this.prisma.storageLocation.findFirst({
      where: { id, tenant_id: tenantId },
      include: { _count: { select: { children: true, stocks: true } } },
    });

    if (!location) throw new NotFoundException('Location not found');

    if (location._count.children > 0) {
      throw new BadRequestException(
        'Cannot delete location with children. Delete children first.',
      );
    }

    if (location._count.stocks > 0) {
      throw new BadRequestException('Cannot delete location containing stock.');
    }

    return this.prisma.storageLocation.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  private async validateHierarchy(
    type: LocationType,
    parentId?: string | null,
  ) {
    const tenantId = await this.tenantContext.getTenantId();
    if (type === LocationType.warehouse) {
      if (parentId)
        throw new BadRequestException(
          'Warehouses cannot have a parent location',
        );
      return;
    }

    if (!parentId)
      throw new BadRequestException(`${type} must have a parent location`);

    const parent = await this.prisma.storageLocation.findFirst({
      where: { id: parentId, tenant_id: tenantId },
    });
    if (!parent) throw new NotFoundException('Parent location not found');

    // Strict Hierarchy Rules

    const allowedParents: Record<string, LocationType[]> = {
      [LocationType.aisle]: [LocationType.warehouse],
      [LocationType.shelf]: [LocationType.aisle, LocationType.warehouse],
      [LocationType.bin]: [
        LocationType.shelf,
        LocationType.aisle,
        LocationType.warehouse,
      ],
      [LocationType.customer_storage]: [LocationType.warehouse],
      [LocationType.staging_tote]: [LocationType.warehouse],
    };

    const allowedParentsForType = allowedParents[type as string];
    if (!allowedParentsForType) {
      throw new BadRequestException(
        `Unsupported location type hierarchy for ${type}`,
      );
    }

    if (!allowedParentsForType.includes(parent.type)) {
      throw new BadRequestException(
        `Location of type ${type} cannot be child of ${parent.type}. Allowed parents: ${allowedParentsForType.join(', ')}`,
      );
    }
  }
}
