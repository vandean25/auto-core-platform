import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateLaborCategoryDto,
  UpdateLaborCategoryDto,
} from './dto/labor-category.dto';
import { toDecimalNumber, rethrowAsConflict } from './labor-shared.helpers';

// ── Private guard / helper types ──────────────────────────────────────────────

/** Minimal shape returned by the parent-lookup select. */
interface ParentRecord {
  id: string;
  parent_id: string | null;
}

@Injectable()
export class LaborCategoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // ── findAll ───────────────────────────────────────────────────────────────

  /**
   * Returns tree-structured categories: top-level parents with their
   * children nested. Only depth-1 children are included (max depth = 2).
   */
  async findAll() {
    const tenantId = await this.tenantContext.getTenantId();
    const topLevel = await this.prisma.laborCategory.findMany({
      where: { tenant_id: tenantId, parent_id: null },
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
      default_hourly_rate: toDecimalNumber(cat.default_hourly_rate),
      children: cat.children.map((child) => ({
        ...child,
        default_hourly_rate: toDecimalNumber(child.default_hourly_rate),
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

  // ── create ────────────────────────────────────────────────────────────────

  async create(dto: CreateLaborCategoryDto) {
    const tenantId = await this.tenantContext.getTenantId();

    await this.assertNameAvailable(tenantId, dto.name);
    await this.assertParentValid(tenantId, dto.parent_id);

    try {
      const created = await this.prisma.laborCategory.create({
        data: {
          tenant_id: tenantId,
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
        default_hourly_rate: toDecimalNumber(created.default_hourly_rate),
      };
    } catch (error) {
      rethrowAsConflict(
        error,
        `Labor category with name "${dto.name}" already exists`,
      );
    }
  }

  // ── update ────────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateLaborCategoryDto) {
    const tenantId = await this.tenantContext.getTenantId();

    const category = await this.assertCategoryUpdatable(tenantId, id);
    await this.assertNameAvailable(tenantId, dto.name, category.name);
    await this.assertParentChangeValid(tenantId, id, dto.parent_id);

    try {
      const updateResult = await this.prisma.laborCategory.updateMany({
        where: { id, tenant_id: tenantId },
        data: this.resolveUpdateData(dto),
      });

      if (updateResult.count === 0) {
        throw new NotFoundException(`Labor category with ID "${id}" not found`);
      }

      this.cascadeRateUpdates(tenantId, id, dto.default_hourly_rate);

      const updated = await this.prisma.laborCategory.findFirst({
        where: { id, tenant_id: tenantId },
      });

      if (!updated) {
        throw new NotFoundException(`Labor category with ID "${id}" not found`);
      }

      return {
        ...updated,
        default_hourly_rate: toDecimalNumber(updated.default_hourly_rate),
      };
    } catch (error) {
      rethrowAsConflict(
        error,
        `Labor category with name "${dto.name}" already exists`,
      );
    }
  }

  // ── remove ────────────────────────────────────────────────────────────────

  async remove(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const category = await this.prisma.laborCategory.findFirst({
      where: { id, tenant_id: tenantId },
    });

    if (!category) {
      throw new NotFoundException(`Labor category with ID "${id}" not found`);
    }

    // Guard: no child categories
    const childCount = await this.prisma.laborCategory.count({
      where: { tenant_id: tenantId, parent_id: id },
    });
    if (childCount > 0) {
      throw new ConflictException(
        `Cannot delete category: it has ${childCount} child ${childCount === 1 ? 'category' : 'categories'}. Remove them first.`,
      );
    }

    // Guard: no LaborOperations referencing this category
    const operationCount = await this.prisma.laborOperation.count({
      where: { tenant_id: tenantId, category_id: id },
    });
    if (operationCount > 0) {
      throw new ConflictException(
        `Cannot delete category: ${operationCount} labor ${operationCount === 1 ? 'operation references' : 'operations reference'} it.`,
      );
    }

    const defaultCatalogSettingsCount =
      await this.prisma.catalogProviderSettings.count({
        where: {
          tenant_id: tenantId,
          default_labor_category_id: id,
        },
      });
    if (defaultCatalogSettingsCount > 0) {
      throw new ConflictException(
        'Cannot delete category: it is the default labor category for catalog provider settings.',
      );
    }

    const deleteResult = await this.prisma.laborCategory.deleteMany({
      where: { id, tenant_id: tenantId },
    });

    if (deleteResult.count === 0) {
      throw new NotFoundException(`Labor category with ID "${id}" not found`);
    }

    return {
      ...category,
      default_hourly_rate: toDecimalNumber(category.default_hourly_rate),
    };
  }

  // ── Private guard helpers ─────────────────────────────────────────────────

  /**
   * Ensure a category with `id` exists in this tenant.
   * Returns the found record so callers can use it without a second query.
   * Throws NotFoundException when not found.
   */
  private async assertCategoryUpdatable(tenantId: string, id: string) {
    const category = await this.prisma.laborCategory.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!category) {
      throw new NotFoundException(`Labor category with ID "${id}" not found`);
    }
    return category;
  }

  /**
   * Ensure `name` is not already taken by another category in this tenant.
   * When `currentName` is provided, skip the check if the name is unchanged.
   * Throws ConflictException when the name is taken.
   */
  private async assertNameAvailable(
    tenantId: string,
    name: string | undefined,
    currentName?: string,
  ) {
    if (name === undefined || name === currentName) {
      return;
    }
    const existing = await this.prisma.laborCategory.findFirst({
      where: { tenant_id: tenantId, name },
    });
    if (existing) {
      throw new ConflictException(
        `Labor category with name "${name}" already exists`,
      );
    }
  }

  /**
   * Validate `parent_id` for create operations.
   * - Throws NotFoundException when the parent does not exist.
   * - Throws BadRequestException when the parent is itself a child (depth > 2).
   *
   * Skipped when `parent_id` is null or undefined.
   */
  private async assertParentValid(
    tenantId: string,
    parentId: string | null | undefined,
  ) {
    if (!parentId) {
      return;
    }
    const parent = await this.lookupParent(tenantId, parentId);
    this.assertParentIsTopLevel(parent, parentId);
  }

  /**
   * Validate a parent change during an update operation.
   * In addition to the basic parent checks, guards against creating a
   * 3-level hierarchy when the category being moved already has children.
   *
   * Skipped when `parent_id` is undefined or null.
   */
  private async assertParentChangeValid(
    tenantId: string,
    id: string,
    parentId: string | null | undefined,
  ) {
    if (parentId === undefined || parentId === null) {
      return;
    }

    if (parentId === id) {
      throw new BadRequestException('A category cannot be its own parent.');
    }

    const parent = await this.lookupParent(tenantId, parentId);
    this.assertParentIsTopLevel(parent, parentId);

    // Guard against depth-3: if this category already has children, making it
    // a child of another category would create a 3-level hierarchy.
    const existingChildCount = await this.prisma.laborCategory.count({
      where: { tenant_id: tenantId, parent_id: id },
    });
    if (existingChildCount > 0) {
      throw new BadRequestException(
        'Cannot move a category that has sub-categories under another parent. This would exceed the maximum depth of 2.',
      );
    }
  }

  /**
   * Fetch a parent category record.
   * Throws NotFoundException when the parent does not exist in this tenant.
   */
  private async lookupParent(
    tenantId: string,
    parentId: string,
  ): Promise<ParentRecord> {
    const parent = await this.prisma.laborCategory.findFirst({
      where: { id: parentId, tenant_id: tenantId },
      select: { id: true, parent_id: true },
    });
    if (!parent) {
      throw new NotFoundException(
        `Parent category with ID "${parentId}" not found`,
      );
    }
    return parent;
  }

  /**
   * Enforce the max-depth-2 rule: the parent must be a top-level category
   * (i.e., it must have no parent of its own).
   * Throws BadRequestException when the depth constraint is violated.
   */
  private assertParentIsTopLevel(parent: ParentRecord, parentId: string) {
    if (parent.parent_id) {
      throw new BadRequestException(
        'Maximum category depth of 2 exceeded. A sub-category cannot have its own sub-categories.',
      );
    }
    // suppress unused-variable warning (parentId used only for documentation)
    void parentId;
  }

  /**
   * Resolve rate override update payload from DTO.
   */
  private resolveRateUpdate(
    dto: UpdateLaborCategoryDto,
  ): Prisma.LaborCategoryUpdateManyMutationInput {
    if (dto.default_hourly_rate !== undefined) {
      return { default_hourly_rate: dto.default_hourly_rate };
    }
    return {};
  }

  /**
   * Cascade rate updates to child categories if needed.
   * Hook for future rate propagation policies across sub-category trees.
   */
  private cascadeRateUpdates(
    tenantId: string,
    categoryId: string,
    rate: number | null | undefined,
  ): void {
    // Child categories inherit rate dynamically at runtime when null;
    // this helper provides the extension point for persisted rate cascading.
    void tenantId;
    void categoryId;
    void rate;
  }

  /**
   * Build the sparse update payload from a DTO, including only fields that are
   * explicitly set (not `undefined`). This avoids accidentally overwriting
   * fields that the caller did not intend to touch.
   */
  private resolveUpdateData(
    dto: UpdateLaborCategoryDto,
  ): Prisma.LaborCategoryUpdateManyMutationInput {
    return {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.sort_order !== undefined && { sort_order: dto.sort_order }),
      ...(dto.parent_id !== undefined && { parent_id: dto.parent_id }),
      ...this.resolveRateUpdate(dto),
      ...(dto.is_active !== undefined && { is_active: dto.is_active }),
    };
  }
}
