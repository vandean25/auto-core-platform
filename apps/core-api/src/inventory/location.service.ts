import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LocationType } from '@prisma/client';

@Injectable()
export class LocationService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.storageLocation.findMany({
      where: { deletedAt: null },
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
    return this.prisma.storageLocation.findMany({
      where: { parent_id: parentId, deletedAt: null },
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { children: true, stocks: true },
        },
      },
    });
  }

  async getBins() {
    return this.prisma.storageLocation.findMany({
      where: { type: 'bin', deletedAt: null },
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
    // Validation
    await this.validateHierarchy(data.type, data.parentId);

    const existingCode = await this.prisma.storageLocation.findUnique({
      where: { code: data.code },
    });
    if (existingCode) {
      throw new BadRequestException('Location code must be unique');
    }

    return this.prisma.storageLocation.create({
      data: {
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
    const location = await this.prisma.storageLocation.findUnique({
      where: { id },
    });
    if (!location) throw new NotFoundException('Location not found');

    if (data.code && data.code !== location.code) {
      const existing = await this.prisma.storageLocation.findUnique({
        where: { code: data.code },
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
    const location = await this.prisma.storageLocation.findUnique({
      where: { id },
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
    if (type === LocationType.warehouse) {
      if (parentId)
        throw new BadRequestException(
          'Warehouses cannot have a parent location',
        );
      return;
    }

    if (!parentId)
      throw new BadRequestException(`${type} must have a parent location`);

    const parent = await this.prisma.storageLocation.findUnique({
      where: { id: parentId },
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
    };

    if (!allowedParents[type as string].includes(parent.type)) {
      throw new BadRequestException(
        `Location of type ${type} cannot be child of ${parent.type}. Allowed parents: ${allowedParents[type as string].join(', ')}`,
      );
    }
  }
}