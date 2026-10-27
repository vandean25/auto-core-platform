import type { ImportJobTotals } from './import.types.js';
import {
  finalizeBackgroundDryRunReconcileIfComplete,
} from './import-background-dry-run.reconcile.js';

describe('finalizeBackgroundDryRunReconcileIfComplete', () => {
  const totals: ImportJobTotals = {
    rows: 4,
    create: 3,
    update: 0,
    skip: 0,
    error: 1,
  };

  it('finalizes and completes when reconcile units are exhausted', async () => {
    const finalize = jest.fn().mockResolvedValue({ totals });
    const completeDryRun = jest.fn().mockResolvedValue(undefined);
    const jobStore = { finalizeBackgroundDryRunReconcile: finalize };

    const done = await finalizeBackgroundDryRunReconcileIfComplete({
      jobStore: jobStore as never,
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
    expect(finalize).toHaveBeenCalled();
    expect(completeDryRun).toHaveBeenCalledWith(totals);
  });

  it('does not finalize while reconcile units remain', async () => {
    const finalize = jest.fn();
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
          dry_run_reconcile_cursor: 0,
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
      completeDryRun: jest.fn(),
    });
    expect(done).toBe(false);
    expect(finalize).not.toHaveBeenCalled();
  });
});
