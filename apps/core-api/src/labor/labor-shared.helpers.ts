import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CreateLaborCategoryDto,
  UpdateLaborCategoryDto,
} from './dto/labor-category.dto.js';

/** Minimal shape returned by the parent-lookup select. */
export interface ParentRecord {
  id: string;
  parent_id: string | null;
}

/** Standard select fields for labor category queries to prevent repetitive projection shapes. */
export const LABOR_CATEGORY_SELECT_FIELDS = {
  id: true,
  name: true,
  description: true,
  sort_order: true,
  parent_id: true,
  default_hourly_rate: true,
  is_active: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Convert a Prisma Decimal (or plain number/null/undefined) to a JS number,
 * preserving 0 as a valid value. Returns null when the input is null or undefined.
 *
 * Shared between LaborCategoryService and LaborService to eliminate duplication.
 */
export function toDecimalNumber(
  value: Prisma.Decimal | number | null | undefined,
): number | null {
  return value !== null && value !== undefined ? Number(value) : null;
}

/**
 * If `error` is a Prisma P2002 unique-constraint violation, throw a
 * ConflictException with the supplied message. Otherwise re-throw `error`
 * unchanged.
 *
 * Usage inside a catch block:
 *   catch (error) { rethrowAsConflict(error, `Foo "bar" already exists`); }
 *
 * The return type is `never` so callers know this function always throws.
 */
export function rethrowAsConflict(error: unknown, message: string): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    throw new ConflictException(message);
  }
  throw error;
}

/**
 * Executes an async action, mapping Prisma P2002 unique constraint violations to ConflictException.
 */
export async function withConflictHandling<T>(
  action: () => Promise<T>,
  conflictMessage: string,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    rethrowAsConflict(error, conflictMessage);
  }
}

/**
 * Enforce the max-depth-2 rule: the parent must be a top-level category
 * (i.e., it must have no parent of its own).
 * Throws BadRequestException when the depth constraint is violated.
 */
export function assertParentIsTopLevel(parent: ParentRecord): void {
  if (parent.parent_id) {
    throw new BadRequestException(
      'Maximum category depth of 2 exceeded. A sub-category cannot have its own sub-categories.',
    );
  }
}

/**
 * Ensures parent record was found, throwing NotFoundException otherwise.
 */
export function ensureParentFound(
  parent: ParentRecord | null,
  parentId: string,
): asserts parent is ParentRecord {
  if (!parent) {
    throw new NotFoundException(
      `Parent category with ID "${parentId}" not found`,
    );
  }
}

/**
 * Ensures a category name is not already claimed.
 */
export function assertNameNotTaken(
  existingCategory: { id: string } | null,
  name: string,
): void {
  if (existingCategory) {
    throw new ConflictException(
      `Labor category with name "${name}" already exists`,
    );
  }
}

/**
 * Ensures related entity count is 0 before allowing deletion.
 */
export function assertNoReferences(
  count: number,
  conflictMessage: string,
): void {
  if (count > 0) {
    throw new ConflictException(conflictMessage);
  }
}

/**
 * Assert that a database mutation affected at least one row, throwing
 * NotFoundException if count is zero.
 */
export function assertAffected(count: number, notFoundMessage: string): void {
  if (count === 0) {
    throw new NotFoundException(notFoundMessage);
  }
}

/**
 * Build create payload for labor category.
 */
export function buildCreateLaborCategoryData(
  tenantId: string,
  dto: CreateLaborCategoryDto,
): Prisma.LaborCategoryUncheckedCreateInput {
  return {
    tenant_id: tenantId,
    name: dto.name,
    description: dto.description,
    sort_order: dto.sort_order ?? 0,
    parent_id: dto.parent_id ?? null,
    default_hourly_rate: dto.default_hourly_rate ?? null,
    is_active: dto.is_active ?? true,
  };
}

/**
 * Build the sparse update payload for labor category from DTO.
 */
export function buildLaborCategoryUpdateData(
  dto: UpdateLaborCategoryDto,
): Prisma.LaborCategoryUpdateManyMutationInput {
  return {
    ...(dto.name !== undefined && { name: dto.name }),
    ...(dto.description !== undefined && { description: dto.description }),
    ...(dto.sort_order !== undefined && { sort_order: dto.sort_order }),
    ...(dto.parent_id !== undefined && { parent_id: dto.parent_id }),
    ...(dto.default_hourly_rate !== undefined && {
      default_hourly_rate: dto.default_hourly_rate,
    }),
    ...(dto.is_active !== undefined && { is_active: dto.is_active }),
  };
}

/**
 * Format category entity with numeric rate.
 */
export function mapLaborCategory<
  T extends { default_hourly_rate: Prisma.Decimal | number | null | undefined },
>(
  category: T,
): Omit<T, 'default_hourly_rate'> & { default_hourly_rate: number | null } {
  return {
    ...category,
    default_hourly_rate: toDecimalNumber(category.default_hourly_rate),
  };
}

/**
 * Computes tree metadata for nested categories.
 */
export function buildCategoryTreeMeta(
  topLevelCategories: Array<{ children: unknown[] }>,
) {
  const childCount = topLevelCategories.reduce(
    (count, category) => count + category.children.length,
    0,
  );
  return {
    total: topLevelCategories.length + childCount,
    topLevelCount: topLevelCategories.length,
    childCount,
  };
}

/**
 * Hook for future rate propagation policies across sub-category trees.
 */
export function cascadeCategoryRateUpdates(
  tenantId: string,
  categoryId: string,
  rate: number | null | undefined,
): void {
  void tenantId;
  void categoryId;
  void rate;
}
