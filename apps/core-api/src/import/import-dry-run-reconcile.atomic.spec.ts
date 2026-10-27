import { ImportEntityType } from '@prisma/client';
import { computeImportDryRunReconcileUnits } from './import-dry-run-reconcile.units.js';
import { importDryRunReconcileProgress } from './import-job.worker-state.js';

describe('atomic reconcile units', () => {
  it('progress advances by full unit row counts only', () => {
    const units = [
      { context_from_row: 1, context_to_row: 3, replan_row_nos: [1, 2, 3] },
      { context_from_row: 10, context_to_row: 11, replan_row_nos: [10, 11] },
    ];
    expect(
      importDryRunReconcileProgress({
        phase: 'dry_run',
        lease_token: 't',
        lease_until: '',
        processed_rows: 0,
        started_at: new Date().toISOString(),
        dry_run_reconcile_active: true,
        dry_run_reconcile_cursor: 1,
        dry_run_reconcile_units: units,
      }),
    ).toBe(3);
    expect(
      importDryRunReconcileProgress({
        phase: 'dry_run',
        lease_token: 't',
        lease_until: '',
        processed_rows: 0,
        started_at: new Date().toISOString(),
        dry_run_reconcile_active: true,
        dry_run_reconcile_cursor: 2,
        dry_run_reconcile_units: units,
      }),
    ).toBe(5);
  });

  it('a far-apart duplicate yields one unit with two row numbers', async () => {
    const prisma = {
      importJobRow: {
        findMany: jest.fn().mockResolvedValue([
          { row_no: 1, external_id: 'dup', normalized_json: {} },
          { row_no: 21_000, external_id: 'dup', normalized_json: {} },
        ]),
      },
    };
    const units = await computeImportDryRunReconcileUnits(prisma as never, {
      tenantId: 't',
      jobId: 'j',
      entityType: ImportEntityType.CUSTOMER,
      batchSize: 500,
    });
    expect(units).toHaveLength(1);
    expect(units[0].replan_row_nos).toEqual([1, 21_000]);
  });

  it('21k-row duplicate span is one reconcile unit (one window per unit)', async () => {
    const rows = [
      { row_no: 1, external_id: 'x', normalized_json: {} },
      { row_no: 21_000, external_id: 'x', normalized_json: {} },
    ];
    const prisma = {
      importJobRow: { findMany: jest.fn().mockResolvedValue(rows) },
    };
    const units = await computeImportDryRunReconcileUnits(prisma as never, {
      tenantId: 't',
      jobId: 'j',
      entityType: ImportEntityType.CUSTOMER,
      batchSize: 500,
    });
    expect(units).toHaveLength(1);
    expect(units[0].replan_row_nos.length).toBe(2);
  });
});
