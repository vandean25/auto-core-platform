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

describe('finalizeBackgroundDryRunReconcileIfComplete', () => {
  it('finalizes when reconcile units are exhausted', async () => {
    const { finalizeBackgroundDryRunReconcileIfComplete } = await import(
      './import-background-dry-run.reconcile.js'
    );
    const totals = {
      rows: 4,
      create: 3,
      update: 0,
      skip: 0,
      error: 1,
    };
    const finalize = jest.fn().mockResolvedValue({ totals });
    const completeDryRun = jest.fn().mockResolvedValue(undefined);

    const done = await finalizeBackgroundDryRunReconcileIfComplete({
      jobStore: { finalizeBackgroundDryRunReconcile: finalize } as never,
      tenantId: 'tenant-1',
      jobId: 'job-1',
      leaseToken: 'lease',
      expectedRows: 4,
      options: {
        worker: {
          phase: 'dry_run',
          lease_token: 'lease',
          lease_until: '',
          processed_rows: 4,
          started_at: new Date().toISOString(),
          dry_run_reconcile_active: true,
          dry_run_reconcile_cursor: 1,
          dry_run_reconcile_target_cursor: 0,
          dry_run_reconcile_units: [
            {
              context_from_row: 1,
              context_to_row: 4,
              replan_row_nos: [1, 4],
            },
          ],
        },
      },
      completeDryRun,
    });

    expect(done).toBe(true);
    expect(completeDryRun).toHaveBeenCalledWith(totals);
  });
});
