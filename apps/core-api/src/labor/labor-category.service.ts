import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateLaborCategoryDto,
  UpdateLaborCategoryDto,
} from './dto/labor-category.dto.js';
import {
  LABOR_CATEGORY_SELECT_FIELDS,
  assertAffected,
  assertNameNotTaken,
  assertNoReferences,
  assertParentIsTopLevel,
  buildCategoryTreeMeta,
  buildCreateLaborCategoryData,
  buildLaborCategoryUpdateData,
  cascadeCategoryRateUpdates,
  ensureParentFound,
  mapLaborCategory,
  withConflictHandling,
} from './labor-shared.helpers.js';

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
        ...LABOR_CATEGORY_SELECT_FIELDS,
        children: {
          orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
          select: LABOR_CATEGORY_SELECT_FIELDS,
        },
      },
    });

    const data = topLevel.map((cat) => ({
      ...mapLaborCategory(cat),
      children: cat.children.map((child) => mapLaborCategory(child)),
    }));

    return {
      data,
      meta: buildCategoryTreeMeta(data),
    };
  }

  // ── create ────────────────────────────────────────────────────────────────

  async create(dto: CreateLaborCategoryDto) {
    const tenantId = await this.tenantContext.getTenantId();

    await this.assertNameAvailable(tenantId, dto.name);
    await this.assertParentValid(tenantId, dto.parent_id);

    return withConflictHandling(async () => {
      const data = buildCreateLaborCategoryData(tenantId, dto);
      const created = await this.prisma.laborCategory.create({ data });
      return mapLaborCategory(created);
    }, `Labor category with name "${dto.name}" already exists`);
  }

  // ── update ────────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateLaborCategoryDto) {
    const tenantId = await this.tenantContext.getTenantId();

    const category = await this.findCategoryOrThrow(tenantId, id);
    await this.assertNameAvailable(tenantId, dto.name, category.name);
    await this.assertParentChangeValid(tenantId, id, dto.parent_id);

    return withConflictHandling(async () => {
      const updateResult = await this.prisma.laborCategory.updateMany({
        where: { id, tenant_id: tenantId },
        data: buildLaborCategoryUpdateData(dto),
      });

      assertAffected(
        updateResult.count,
        `Labor category with ID "${id}" not found`,
      );

      cascadeCategoryRateUpdates(tenantId, id, dto.default_hourly_rate);

      const updated = await this.findCategoryOrThrow(tenantId, id);

      return mapLaborCategory(updated);
    }, `Labor category with name "${dto.name}" already exists`);
  }

  // ── remove ────────────────────────────────────────────────────────────────

  async remove(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const category = await this.findCategoryOrThrow(tenantId, id);

    const [childCount, operationCount, defaultCatalogSettingsCount] =
      await Promise.all([
        this.prisma.laborCategory.count({
          where: { tenant_id: tenantId, parent_id: id },
        }),
        this.prisma.laborOperation.count({
          where: { tenant_id: tenantId, category_id: id },
        }),
        this.prisma.catalogProviderSettings.count({
          where: { tenant_id: tenantId, default_labor_category_id: id },
        }),
      ]);

    assertNoReferences(
      childCount,
      `Cannot delete category: it has ${childCount} child ${childCount === 1 ? 'category' : 'categories'}. Remove them first.`,
    );

    assertNoReferences(
      operationCount,
      `Cannot delete category: ${operationCount} labor ${operationCount === 1 ? 'operation references' : 'operations reference'} it.`,
    );

    assertNoReferences(
      defaultCatalogSettingsCount,
      'Cannot delete category: it is the default labor category for catalog provider settings.',
    );

    const deleteResult = await this.prisma.laborCategory.deleteMany({
      where: { id, tenant_id: tenantId },
    });

    assertAffected(
      deleteResult.count,
      `Labor category with ID "${id}" not found`,
    );

    return mapLaborCategory(category);
  }

  // ── Category and Parent verification helpers ──────────────────────────────

  /**
   * Ensure a category with `id` exists in this tenant.
   * Returns the found record so callers can use it without a second query.
   * Throws NotFoundException when not found.
   */
  private async findCategoryOrThrow(tenantId: string, id: string) {
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
    assertNameNotTaken(existing, name);
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
    const parent = await this.prisma.laborCategory.findFirst({
      where: { id: parentId, tenant_id: tenantId },
      select: { id: true, parent_id: true },
    });
    ensureParentFound(parent, parentId);
    assertParentIsTopLevel(parent);
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

    await this.assertParentValid(tenantId, parentId);

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
}
