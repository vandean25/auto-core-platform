import { ImportJobStatus, ImportRowAction } from '@prisma/client';
import {
  IMPORT_APPLY_BATCH_SIZE,
  IMPORT_WORKER_BATCH_SIZE,
} from './import.constants.js';
import type { ImportJobWorkerState } from './import-job.worker-state.js';
import type { SerializedImportJob } from './import-job.serializer.js';
import type { ImportJobTotals } from './import.types.js';
import { SupplierChunkedApplyRunner } from './supplier-price-list-apply.runner.js';
import { withApplyPersistedTotalsTransactionClient } from './import-apply-persisted-totals.test-util.js';

function makeRows(
  count: number,
  action: ImportRowAction,
  startRowNo = 1,
) {
  return Array.from({ length: count }, (_, index) => ({
    row_no: startRowNo + index,
    action,
    entity_id: null,
    external_id: `ext-${startRowNo + index}`,
    normalized_json: {},
  }));
}

describe('SupplierChunkedApplyRunner background batches', () => {
  it('applies skip-only pages across batches before marking APPLIED', async () => {
    const totalRows = IMPORT_WORKER_BATCH_SIZE + 1;
    const worker: ImportJobWorkerState = {
      phase: 'apply',
      lease_token: 'lease-supplier',
      lease_until: new Date(0).toISOString(),
      processed_rows: 0,
      last_committed_apply_seq: 0,
      started_at: new Date().toISOString(),
    };
    let jobStatus: ImportJobStatus = ImportJobStatus.APPLYING;
    let appliedTotalsJson: ImportJobTotals | undefined;
    const appliedUpdates: unknown[] = [];
    const skipRows = Array.from({ length: totalRows }, () => ({
      action: ImportRowAction.SKIP,
    }));
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = withApplyPersistedTotalsTransactionClient(
          {
            importJob: {
              findFirst: async () => ({
                id: 'job-1',
                tenant_id: 'tenant-1',
                status: jobStatus,
                options_json: { worker },
                totals_json:
                  appliedTotalsJson ?? {
                    rows: totalRows,
                    create: 0,
                    update: 0,
                    skip: totalRows,
                    error: 0,
                  },
              }),
              update: async (args: {
                data: {
                  options_json?: { worker: ImportJobWorkerState };
                  status?: ImportJobStatus;
                };
              }) => {
                if (args.data.options_json?.worker) {
                  Object.assign(worker, args.data.options_json.worker);
                }
                if (args.data.status === ImportJobStatus.APPLIED) {
                  jobStatus = ImportJobStatus.APPLIED;
                  appliedUpdates.push(args.data);
                }
                return { id: 'job-1', status: jobStatus };
              },
              updateMany: async (args: { data: Record<string, unknown> }) => {
                if (args.data.status === ImportJobStatus.APPLIED) {
                  appliedUpdates.push(args.data);
                  jobStatus = ImportJobStatus.APPLIED;
                  appliedTotalsJson = args.data.totals_json as ImportJobTotals;
                }
                return { count: 1 };
              },
            },
            importJobRow: { update: jest.fn() },
          },
          {
            tenantId: 'tenant-1',
            expectedRows: totalRows,
            persistedRows: skipRows,
          },
        );
        return fn(tx);
      },
      importJob: {
        updateMany: async (args: { data: Record<string, unknown> }) => {
          if (args.data.status === ImportJobStatus.APPLIED) {
            appliedUpdates.push(args.data);
            jobStatus = ImportJobStatus.APPLIED;
          }
          return { count: 1 };
        },
        findFirst: async () => ({
          id: 'job-1',
          status: jobStatus,
          totals_json: {
            rows: totalRows,
            create: 0,
            update: 0,
            skip: totalRows,
            error: 0,
          },
        }),
        update: jest.fn(),
      },
      importJobRow: { update: jest.fn() },
    };
    const runner = new SupplierChunkedApplyRunner(
      prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, totals) =>
        ({ ...job, totals, status: job.status }) as unknown as SerializedImportJob,
    );
    const vendor = { id: 'vendor-1', name: 'Vendor' };

    let totalsJson = {
      rows: totalRows,
      create: 0,
      update: 0,
      skip: 0,
      error: 0,
    };
    let lastResult: SerializedImportJob | undefined;

    while ((worker.last_committed_apply_seq ?? 0) < totalRows) {
      const resumeAfter = worker.last_committed_apply_seq ?? 0;
      const batchStart = resumeAfter + 1;
      const remaining = totalRows - resumeAfter;
      const pageLen = Math.min(IMPORT_APPLY_BATCH_SIZE, remaining);
      const page = makeRows(pageLen, ImportRowAction.SKIP, batchStart);
      const hasMoreRowsAfterBatch = resumeAfter + pageLen < totalRows;
      lastResult = await runner.run(
        {
          tenantId: 'tenant-1',
          job: {
            id: 'job-1',
            source_system: 'legacy',
            options_json: { worker },
            totals_json: totalsJson,
          },
          rows: page,
          actorUserId: 'user-1',
          effectiveOptions: { vendor_id: 'vendor-1' },
          preparation: { vendor },
          batchOptions: {
            resumeAfterApplySeq: resumeAfter,
            stopAfterBatch: true,
            hasMoreRowsAfterBatch,
            leaseToken: worker.lease_token,
          },
        },
        vendor,
      );
      totalsJson = lastResult.totals;
      expect(worker.last_committed_apply_seq).toBe(resumeAfter + pageLen);
    }

    expect(lastResult?.status).toBe(ImportJobStatus.APPLIED);
    expect(lastResult?.totals.skip).toBe(totalRows);
    expect(worker.last_committed_apply_seq).toBe(totalRows);
    expect(appliedUpdates).toHaveLength(1);
  });
});
