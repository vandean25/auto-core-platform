import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateLaborCategoryDto,
  UpdateLaborCategoryDto,
} from './dto/labor-category.dto';

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

    return {
      data: topLevel.map((cat) => ({
        ...cat,
        default_hourly_rate: cat.default_hourly_rate
          ? Number(cat.default_hourly_rate)
          : null,
        children: cat.children.map((child) => ({
          ...child,
          default_hourly_rate: child.default_hourly_rate
            ? Number(child.default_hourly_rate)
            : null,
        })),
      })),
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

    return {
      ...created,
      default_hourly_rate: created.default_hourly_rate
        ? Number(created.default_hourly_rate)
        : null,
    };
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
    }

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

    return {
      ...updated,
      default_hourly_rate: updated.default_hourly_rate
        ? Number(updated.default_hourly_rate)
        : null,
    };
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

    return {
      ...deleted,
      default_hourly_rate: deleted.default_hourly_rate
        ? Number(deleted.default_hourly_rate)
        : null,
    };
  }
}
