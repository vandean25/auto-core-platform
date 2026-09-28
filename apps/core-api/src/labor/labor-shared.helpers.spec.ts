import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  toDecimalNumber,
  rethrowAsConflict,
  withConflictHandling,
  assertParentIsTopLevel,
  ensureParentFound,
  assertNameNotTaken,
  assertNoReferences,
  assertAffected,
  buildCreateLaborCategoryData,
  buildLaborCategoryUpdateData,
  mapLaborCategory,
  buildCategoryTreeMeta,
  cascadeCategoryRateUpdates,
} from './labor-shared.helpers.js';

// ── toDecimalNumber ───────────────────────────────────────────────────────────

describe('toDecimalNumber', () => {
  it('converts a plain JS number to itself', () => {
    expect(toDecimalNumber(95.5)).toBe(95.5);
  });

  it('preserves 0 (does not treat it as falsy/null)', () => {
    expect(toDecimalNumber(0)).toBe(0);
  });

  it('returns null when the input is null', () => {
    expect(toDecimalNumber(null)).toBeNull();
  });

  it('returns null when the input is undefined', () => {
    expect(toDecimalNumber(undefined)).toBeNull();
  });

  it('converts a Prisma Decimal object to a JS number', () => {
    const decimal = new Prisma.Decimal('123.45');
    expect(toDecimalNumber(decimal)).toBe(123.45);
  });

  it('converts a Prisma Decimal of 0 to the number 0 (not null)', () => {
    const decimal = new Prisma.Decimal('0');
    expect(toDecimalNumber(decimal)).toBe(0);
  });

  it('handles negative numbers correctly', () => {
    expect(toDecimalNumber(-42.5)).toBe(-42.5);
  });
});

// ── rethrowAsConflict ─────────────────────────────────────────────────────────

describe('rethrowAsConflict', () => {
  it('throws ConflictException for a Prisma P2002 error', () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: '0' },
    );
    expect(() => rethrowAsConflict(p2002, 'Already exists')).toThrow(
      ConflictException,
    );
  });

  it('includes the caller-supplied message in the ConflictException', () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: '0' },
    );
    expect(() => rethrowAsConflict(p2002, 'Custom message here')).toThrow(
      'Custom message here',
    );
  });

  it('re-throws non-P2002 Prisma errors unchanged', () => {
    const p2025 = new Prisma.PrismaClientKnownRequestError(
      'Record not found',
      { code: 'P2025', clientVersion: '0' },
    );
    expect(() => rethrowAsConflict(p2025, 'irrelevant')).toThrow(p2025);
  });

  it('re-throws generic Error objects unchanged', () => {
    const err = new Error('Some other error');
    expect(() => rethrowAsConflict(err, 'irrelevant')).toThrow(err);
  });

  it('re-throws non-Error primitives unchanged', () => {
    expect(() => rethrowAsConflict('string error', 'irrelevant')).toThrow(
      'string error',
    );
  });

  it('does NOT throw ConflictException for P2002 with a different code prefix', () => {
    const p2000 = new Prisma.PrismaClientKnownRequestError(
      'Different code',
      { code: 'P2000', clientVersion: '0' },
    );
    expect(() => rethrowAsConflict(p2000, 'irrelevant')).toThrow(p2000);
    expect(() => rethrowAsConflict(p2000, 'irrelevant')).not.toThrow(
      ConflictException,
    );
  });
});

// ── withConflictHandling ──────────────────────────────────────────────────────

describe('withConflictHandling', () => {
  it('returns the result of the action on success', async () => {
    const result = await withConflictHandling(
      async () => 'success-value',
      'Conflict occurred',
    );
    expect(result).toBe('success-value');
  });

  it('translates P2002 Prisma error to ConflictException with message', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: '0' },
    );
    await expect(
      withConflictHandling(async () => {
        throw p2002;
      }, 'Category with name already exists'),
    ).rejects.toThrow(ConflictException);

    await expect(
      withConflictHandling(async () => {
        throw p2002;
      }, 'Category with name already exists'),
    ).rejects.toThrow('Category with name already exists');
  });

  it('re-throws other errors unchanged', async () => {
    const genericError = new Error('Database connection failed');
    await expect(
      withConflictHandling(async () => {
        throw genericError;
      }, 'Conflict occurred'),
    ).rejects.toThrow(genericError);
  });
});

// ── assertParentIsTopLevel ────────────────────────────────────────────────────

describe('assertParentIsTopLevel', () => {
  it('does not throw when parent has no parent_id (is top-level)', () => {
    expect(() =>
      assertParentIsTopLevel({ id: 'cat-1', parent_id: null }),
    ).not.toThrow();
  });

  it('throws BadRequestException when parent has a parent_id (depth > 1)', () => {
    expect(() =>
      assertParentIsTopLevel({ id: 'cat-2', parent_id: 'cat-1' }),
    ).toThrow(BadRequestException);
    expect(() =>
      assertParentIsTopLevel({ id: 'cat-2', parent_id: 'cat-1' }),
    ).toThrow(/Maximum category depth of 2 exceeded/);
  });
});

// ── ensureParentFound ─────────────────────────────────────────────────────────

describe('ensureParentFound', () => {
  it('does not throw when parent record exists', () => {
    expect(() =>
      ensureParentFound({ id: 'cat-1', parent_id: null }, 'cat-1'),
    ).not.toThrow();
  });

  it('throws NotFoundException when parent record is null', () => {
    expect(() => ensureParentFound(null, 'cat-999')).toThrow(
      NotFoundException,
    );
    expect(() => ensureParentFound(null, 'cat-999')).toThrow(
      'Parent category with ID "cat-999" not found',
    );
  });
});

// ── assertNameNotTaken ────────────────────────────────────────────────────────

describe('assertNameNotTaken', () => {
  it('does not throw when existingCategory is null', () => {
    expect(() => assertNameNotTaken(null, 'Brakes')).not.toThrow();
  });

  it('throws ConflictException when existingCategory is found', () => {
    expect(() => assertNameNotTaken({ id: 'existing-id' }, 'Brakes')).toThrow(
      ConflictException,
    );
    expect(() => assertNameNotTaken({ id: 'existing-id' }, 'Brakes')).toThrow(
      'Labor category with name "Brakes" already exists',
    );
  });
});

// ── assertNoReferences ────────────────────────────────────────────────────────

describe('assertNoReferences', () => {
  it('does not throw when count is 0', () => {
    expect(() =>
      assertNoReferences(0, 'Cannot delete category with references'),
    ).not.toThrow();
  });

  it('throws ConflictException when count is greater than 0', () => {
    expect(() =>
      assertNoReferences(3, 'Cannot delete category with active subcategories'),
    ).toThrow(ConflictException);
    expect(() =>
      assertNoReferences(3, 'Cannot delete category with active subcategories'),
    ).toThrow('Cannot delete category with active subcategories');
  });
});

// ── assertAffected ────────────────────────────────────────────────────────────

describe('assertAffected', () => {
  it('does not throw when count is at least 1', () => {
    expect(() =>
      assertAffected(1, 'Labor category not found'),
    ).not.toThrow();
    expect(() =>
      assertAffected(5, 'Labor category not found'),
    ).not.toThrow();
  });

  it('throws NotFoundException when count is 0', () => {
    expect(() => assertAffected(0, 'Labor category not found')).toThrow(
      NotFoundException,
    );
    expect(() => assertAffected(0, 'Labor category not found')).toThrow(
      'Labor category not found',
    );
  });
});

// ── buildCreateLaborCategoryData ──────────────────────────────────────────────

describe('buildCreateLaborCategoryData', () => {
  it('builds unchecked create input with defaults', () => {
    const data = buildCreateLaborCategoryData('tenant-1', {
      name: 'Diagnostic',
    });
    expect(data).toEqual({
      tenant_id: 'tenant-1',
      name: 'Diagnostic',
      description: undefined,
      sort_order: 0,
      parent_id: null,
      default_hourly_rate: null,
      is_active: true,
    });
  });

  it('preserves provided optional properties', () => {
    const data = buildCreateLaborCategoryData('tenant-1', {
      name: 'Electrical',
      description: 'Wiring and sensors',
      sort_order: 5,
      parent_id: 'parent-cat-id',
      default_hourly_rate: 120,
      is_active: false,
    });
    expect(data).toEqual({
      tenant_id: 'tenant-1',
      name: 'Electrical',
      description: 'Wiring and sensors',
      sort_order: 5,
      parent_id: 'parent-cat-id',
      default_hourly_rate: 120,
      is_active: false,
    });
  });
});

// ── buildLaborCategoryUpdateData ──────────────────────────────────────────────

describe('buildLaborCategoryUpdateData', () => {
  it('creates an empty update object when all fields are undefined', () => {
    expect(buildLaborCategoryUpdateData({})).toEqual({});
  });

  it('includes only defined fields in update object', () => {
    const update = buildLaborCategoryUpdateData({
      name: 'Updated Name',
      is_active: false,
    });
    expect(update).toEqual({
      name: 'Updated Name',
      is_active: false,
    });
    expect(update).not.toHaveProperty('description');
    expect(update).not.toHaveProperty('parent_id');
  });
});

// ── mapLaborCategory ──────────────────────────────────────────────────────────

describe('mapLaborCategory', () => {
  it('transforms Decimal rate to number and keeps other attributes', () => {
    const raw = {
      id: 'cat-1',
      name: 'Oil Change',
      default_hourly_rate: new Prisma.Decimal('85.50'),
    };
    const mapped = mapLaborCategory(raw);
    expect(mapped).toEqual({
      id: 'cat-1',
      name: 'Oil Change',
      default_hourly_rate: 85.5,
    });
  });

  it('transforms null rate to null', () => {
    const raw = {
      id: 'cat-2',
      name: 'General',
      default_hourly_rate: null,
    };
    const mapped = mapLaborCategory(raw);
    expect(mapped.default_hourly_rate).toBeNull();
  });
});

// ── buildCategoryTreeMeta ─────────────────────────────────────────────────────

describe('buildCategoryTreeMeta', () => {
  it('calculates total, topLevelCount, and childCount', () => {
    const topLevel = [
      { children: [{ id: 'sub-1' }, { id: 'sub-2' }] },
      { children: [] },
      { children: [{ id: 'sub-3' }] },
    ];
    const meta = buildCategoryTreeMeta(topLevel);
    expect(meta).toEqual({
      total: 6,
      topLevelCount: 3,
      childCount: 3,
    });
  });

  it('handles empty tree', () => {
    expect(buildCategoryTreeMeta([])).toEqual({
      total: 0,
      topLevelCount: 0,
      childCount: 0,
    });
  });
});

// ── cascadeCategoryRateUpdates ────────────────────────────────────────────────

describe('cascadeCategoryRateUpdates', () => {
  it('runs without throwing errors as a placeholder hook', () => {
    expect(() =>
      cascadeCategoryRateUpdates('tenant-1', 'cat-1', 100),
    ).not.toThrow();
  });
});
