import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateLaborCategoryDto,
  UpdateLaborCategoryDto,
} from './dto/labor-category.dto';

/** Convert a Prisma Decimal (or plain number) to a JS number, preserving 0. */
function toNumber(value: Prisma.Decimal | null | undefined): number | null {
  return value !== null && value !== undefined ? Number(value) : null;
}

@Injectable()
export class LaborCategoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns tree-structured categories: top-level parents with their
   * children nested. Only depth-1 children are included (max depth = 2).
   */
  async findAll() {
    const topLevel = await this.prisma.laborCategory.findMany({
      where: { parent_id: null },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        sort_order: true,
        parent_id: true,
        default_hourly_rate: true,
        is_active: true,
        createdAt: true,
        updatedAt: true,
        children: {
          orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
          select: {
            id: true,
            name: true,
            description: true,
            sort_order: true,
            parent_id: true,
            default_hourly_rate: true,
            is_active: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    const data = topLevel.map((cat) => ({
      ...cat,
      default_hourly_rate: toNumber(cat.default_hourly_rate),
      children: cat.children.map((child) => ({
        ...child,
        default_hourly_rate: toNumber(child.default_hourly_rate),
      })),
    }));

    const childCount = data.reduce(
      (count, category) => count + category.children.length,
      0,
    );

    return {
      data,
      meta: {
        total: data.length + childCount,
        topLevelCount: data.length,
        childCount,
      },
    };
  }

  async create(dto: CreateLaborCategoryDto) {
    // Validate unique name
    const existing = await this.prisma.laborCategory.findUnique({
      where: { name: dto.name },
    });
    if (existing) {
      throw new ConflictException(
        `Labor category with name "${dto.name}" already exists`,
      );
    }

    // Validate parent exists and depth constraint
    if (dto.parent_id) {
      const parent = await this.prisma.laborCategory.findUnique({
        where: { id: dto.parent_id },
        select: { id: true, parent_id: true },
      });

      if (!parent) {
        throw new NotFoundException(
          `Parent category with ID "${dto.parent_id}" not found`,
        );
      }

      // Max depth = 2: parent must be a top-level category (no parent itself)
      if (parent.parent_id) {
        throw new BadRequestException(
          'Maximum category depth of 2 exceeded. A sub-category cannot have its own sub-categories.',
        );
      }
    }

    try {
      const created = await this.prisma.laborCategory.create({
        data: {
          name: dto.name,
          description: dto.description,
          sort_order: dto.sort_order ?? 0,
          parent_id: dto.parent_id ?? null,
          default_hourly_rate: dto.default_hourly_rate ?? null,
          is_active: dto.is_active ?? true,
        },
      });

      return { ...created, default_hourly_rate: toNumber(created.default_hourly_rate) };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `Labor category with name "${dto.name}" already exists`,
        );
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateLaborCategoryDto) {
    const category = await this.prisma.laborCategory.findUnique({
      where: { id },
    });

    if (!category) {
      throw new NotFoundException(`Labor category with ID "${id}" not found`);
    }

    // Validate unique name if being changed
    if (dto.name !== undefined && dto.name !== category.name) {
      const existing = await this.prisma.laborCategory.findUnique({
        where: { name: dto.name },
      });
      if (existing) {
        throw new ConflictException(
          `Labor category with name "${dto.name}" already exists`,
        );
      }
    }

    // Validate parent if being changed
    if (dto.parent_id !== undefined && dto.parent_id !== null) {
      if (dto.parent_id === id) {
        throw new BadRequestException('A category cannot be its own parent.');
      }

      const parent = await this.prisma.laborCategory.findUnique({
        where: { id: dto.parent_id },
        select: { id: true, parent_id: true },
      });

      if (!parent) {
        throw new NotFoundException(
          `Parent category with ID "${dto.parent_id}" not found`,
        );
      }

      if (parent.parent_id) {
        throw new BadRequestException(
          'Maximum category depth of 2 exceeded. A sub-category cannot have its own sub-categories.',
        );
      }

      // Guard against depth-3: if this category already has children, making
      // it a child of another category would create a 3-level hierarchy.
      const existingChildCount = await this.prisma.laborCategory.count({
        where: { parent_id: id },
      });
      if (existingChildCount > 0) {
        throw new BadRequestException(
          'Cannot move a category that has sub-categories under another parent. This would exceed the maximum depth of 2.',
        );
      }
    }

    try {
      const updated = await this.prisma.laborCategory.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.sort_order !== undefined && { sort_order: dto.sort_order }),
          ...(dto.parent_id !== undefined && { parent_id: dto.parent_id }),
          ...(dto.default_hourly_rate !== undefined && {
            default_hourly_rate: dto.default_hourly_rate,
          }),
          ...(dto.is_active !== undefined && { is_active: dto.is_active }),
        },
      });

      return { ...updated, default_hourly_rate: toNumber(updated.default_hourly_rate) };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `Labor category with name "${dto.name}" already exists`,
        );
      }
      throw error;
    }
  }

  async remove(id: string) {
    const category = await this.prisma.laborCategory.findUnique({
      where: { id },
    });

    if (!category) {
      throw new NotFoundException(`Labor category with ID "${id}" not found`);
    }

    // Guard: no child categories
    const childCount = await this.prisma.laborCategory.count({
      where: { parent_id: id },
    });
    if (childCount > 0) {
      throw new ConflictException(
        `Cannot delete category: it has ${childCount} child ${childCount === 1 ? 'category' : 'categories'}. Remove them first.`,
      );
    }

    // Guard: no LaborOperations referencing this category
    const operationCount = await this.prisma.laborOperation.count({
      where: { category_id: id },
    });
    if (operationCount > 0) {
      throw new ConflictException(
        `Cannot delete category: ${operationCount} labor ${operationCount === 1 ? 'operation references' : 'operations reference'} it.`,
      );
    }

    const deleted = await this.prisma.laborCategory.delete({
      where: { id },
    });

    return { ...deleted, default_hourly_rate: toNumber(deleted.default_hourly_rate) };
  }
}
