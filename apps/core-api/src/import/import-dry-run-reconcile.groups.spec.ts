import { ImportEntityType } from '@prisma/client';
import { computeImportDryRunReconcileRanges } from './import-dry-run-reconcile.groups.js';

describe('computeImportDryRunReconcileRanges', () => {
  const tenantId = 'tenant-1';
  const jobId = 'job-1';

  function prismaWithRows(
    rows: Array<{
      row_no: number;
      external_id: string | null;
      normalized_json?: unknown;
    }>,
  ) {
    return {
      importJobRow: {
        findMany: jest.fn().mockResolvedValue(rows),
      },
    } as never;
  }

  it('returns no ranges when duplicate external ids stay within one batch', async () => {
    const prisma = prismaWithRows([
      { row_no: 1, external_id: 'dup' },
      { row_no: 2, external_id: 'dup' },
    ]);
    const ranges = await computeImportDryRunReconcileRanges(prisma, {
      tenantId,
      jobId,
      entityType: ImportEntityType.CUSTOMER,
      batchSize: 500,
    });
    expect(ranges).toEqual([]);
  });

  it('returns units with only duplicate row numbers, not filler rows between far-apart duplicates', async () => {
    const prisma = prismaWithRows([
      { row_no: 1, external_id: 'far' },
      { row_no: 21_000, external_id: 'far' },
    ]);
    const units = await computeImportDryRunReconcileRanges(prisma, {
      tenantId,
      jobId,
      entityType: ImportEntityType.CUSTOMER,
      batchSize: 500,
    });
    expect(units).toEqual([{ from_row: 1, to_row: 21_000 }]);
    const { computeImportDryRunReconcileUnits } = await import(
      './import-dry-run-reconcile.units.js'
    );
    const reconcileUnits = await computeImportDryRunReconcileUnits(prisma, {
      tenantId,
      jobId,
      entityType: ImportEntityType.CUSTOMER,
      batchSize: 500,
    });
    expect(reconcileUnits[0].replan_row_nos).toEqual([1, 21_000]);
  });

  it('merges overlapping reconcile windows for cross-batch duplicates', async () => {
    const prisma = prismaWithRows([
      { row_no: 10, external_id: 'a' },
      { row_no: 510, external_id: 'b' },
      { row_no: 511, external_id: 'a' },
    ]);
    const ranges = await computeImportDryRunReconcileRanges(prisma, {
      tenantId,
      jobId,
      entityType: ImportEntityType.VEHICLE_PARTY,
      batchSize: 500,
    });
    expect(ranges).toEqual([{ from_row: 10, to_row: 511 }]);
  });
});
