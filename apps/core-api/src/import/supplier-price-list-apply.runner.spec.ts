import { ImportJobStatus, ImportRowAction, Prisma } from '@prisma/client';
import {
  IMPORT_APPLY_BATCH_SIZE,
  IMPORT_SYNC_ROW_TX_MAX_ATTEMPTS,
  IMPORT_WORKER_BATCH_SIZE,
} from './import.constants.js';
import { ImportApplyRetryExhaustedError } from './import-apply.errors.js';
import type { ImportJobWorkerState } from './import-job.worker-state.js';
import type { SerializedImportJob } from './import-job.serializer.js';
import type { ImportJobTotals } from './import.types.js';
import type {
  ImportApplyBatchOptions,
  ImportApplyInput,
  ImportApplyJob,
  ImportApplyRow,
} from './import-type-handler.js';
import { SupplierChunkedApplyRunner } from './supplier-price-list-apply.runner.js';
import { withApplyPersistedTotalsTransactionClient } from './import-apply-persisted-totals.test-util.js';

const vendor = { id: 'vendor-1', name: 'Vendor' };

function p2034(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('write conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

function makeRunner(prisma: unknown) {
  return new SupplierChunkedApplyRunner(
    prisma as never,
    { writeImportJobAudit: jest.fn() } as never,
    (job, totals) =>
      ({
        ...job,
        totals,
        status: job.status,
      }) as unknown as SerializedImportJob,
  );
}

function skipRowRow(rowNo: number) {
  return {
    row_no: rowNo,
    action: ImportRowAction.SKIP,
    entity_id: null,
    external_id: `ext-${rowNo}`,
    normalized_json: {},
  };
}

function supplierInput(
  rows: ImportApplyRow[],
  overrides: {
    job?: Partial<ImportApplyJob>;
    batchOptions?: ImportApplyBatchOptions;
    totalsJson?: ImportJobTotals;
  } = {},
): ImportApplyInput {
  return {
    tenantId: 'tenant-1',
    job: {
      id: 'job-supplier',
      source_system: 'legacy',
      options_json: {},
      totals_json:
        overrides.totalsJson ??
        ({
          rows: rows.length,
          create: 0,
          update: 0,
          skip: 0,
          error: 0,
        }),
      ...overrides.job,
    },
    rows,
    actorUserId: 'user-1',
    effectiveOptions: { vendor_id: 'vendor-1' },
    preparation: { vendor },
    batchOptions: overrides.batchOptions,
  };
}

function backgroundWorker(leaseToken: string): ImportJobWorkerState {
  return {
    phase: 'apply',
    lease_token: leaseToken,
    lease_until: new Date(0).toISOString(),
    processed_rows: 0,
    last_committed_apply_seq: 0,
    started_at: new Date().toISOString(),
  };
}

describe('SupplierChunkedApplyRunner', () => {
  it('applies skip-only pages across background batches before marking APPLIED', async () => {
    const totalRows = IMPORT_WORKER_BATCH_SIZE + 1;
    const worker = backgroundWorker('lease-supplier');
    let jobStatus: ImportJobStatus = ImportJobStatus.APPLYING;
    let appliedTotalsJson: ImportJobTotals | undefined;
    const appliedUpdates: unknown[] = [];
    const bumpStatus = (data: Record<string, unknown>) => {
      if (data.status === ImportJobStatus.APPLIED) {
        appliedUpdates.push(data);
        jobStatus = ImportJobStatus.APPLIED;
        appliedTotalsJson = data.totals_json as ImportJobTotals;
      }
    };
    const storedTotals = (): ImportJobTotals =>
      appliedTotalsJson ?? {
        rows: totalRows,
        create: 0,
        update: 0,
        skip: totalRows,
        error: 0,
      };
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = withApplyPersistedTotalsTransactionClient(
          {
            importJob: {
              findFirst: async () => ({
                id: 'job-supplier',
                tenant_id: 'tenant-1',
                status: jobStatus,
                options_json: { worker },
                totals_json: storedTotals(),
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
                return { id: 'job-supplier', status: jobStatus };
              },
              updateMany: async (args: { data: Record<string, unknown> }) => {
                bumpStatus(args.data);
                return { count: 1 };
              },
            },
            importJobRow: { update: jest.fn() },
          },
          {
            tenantId: 'tenant-1',
            expectedRows: totalRows,
            persistedRows: Array.from({ length: totalRows }, () => ({
              action: ImportRowAction.SKIP,
            })),
          },
        );
        return fn(tx);
      },
      importJob: {
        updateMany: async (args: { data: Record<string, unknown> }) => {
          bumpStatus(args.data);
          return { count: 1 };
        },
        findFirst: async () => ({
          id: 'job-supplier',
          status: jobStatus,
          totals_json: storedTotals(),
        }),
        update: jest.fn(),
      },
      importJobRow: { update: jest.fn() },
    };
    const runner = makeRunner(prisma);

    let totalsJson: ImportJobTotals = {
      rows: totalRows,
      create: 0,
      update: 0,
      skip: 0,
      error: 0,
    };
    let lastResult: SerializedImportJob | undefined;

    while ((worker.last_committed_apply_seq ?? 0) < totalRows) {
      const resumeAfter = worker.last_committed_apply_seq ?? 0;
      const pageLen = Math.min(
        IMPORT_APPLY_BATCH_SIZE,
        totalRows - resumeAfter,
      );
      const page = Array.from({ length: pageLen }, (_, index) =>
        skipRowRow(resumeAfter + index + 1),
      );
      lastResult = await runner.run(
        supplierInput(page, {
          job: {
            id: 'job-1',
            options_json: { worker },
          },
          totalsJson,
          batchOptions: {
            resumeAfterApplySeq: resumeAfter,
            stopAfterBatch: true,
            hasMoreRowsAfterBatch: resumeAfter + pageLen < totalRows,
            leaseToken: worker.lease_token,
          },
        }),
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

  it('rethrows background P2034 on finish without marking the job FAILED', async () => {
    const worker = backgroundWorker('lease-1');
    let jobStatus: ImportJobStatus = ImportJobStatus.APPLYING;
    let txCalls = 0;
    const updateMany = jest.fn(
      async (args: { data: { status?: ImportJobStatus } }) => {
        if (args.data.status === ImportJobStatus.FAILED) {
          jobStatus = ImportJobStatus.FAILED;
        }
        return { count: 1 };
      },
    );
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        txCalls += 1;
        if (txCalls > 1) {
          throw p2034();
        }
        const tx = withApplyPersistedTotalsTransactionClient(
          {
            importJob: {
              update: async () => ({ id: 'job-supplier', status: jobStatus }),
              findFirst: async () => ({
                id: 'job-supplier',
                tenant_id: 'tenant-1',
                status: jobStatus,
                options_json: { worker },
                totals_json: {
                  rows: 1,
                  create: 0,
                  update: 0,
                  skip: 1,
                  error: 0,
                },
              }),
            },
            importJobRow: { update: jest.fn() },
          },
          {
            tenantId: 'tenant-1',
            expectedRows: 1,
            persistedRows: [{ action: ImportRowAction.SKIP }],
          },
        );
        return fn(tx);
      },
      importJob: {
        updateMany,
        findFirst: async () => ({ id: 'job-supplier', status: jobStatus }),
        update: jest.fn(),
      },
      importJobRow: { update: jest.fn() },
    };
    const runner = makeRunner(prisma);

    await expect(
      runner.run(
        supplierInput([skipRowRow(1)], {
          job: { options_json: { worker } },
          batchOptions: {
            stopAfterBatch: true,
            leaseToken: 'lease-1',
            resumeAfterApplySeq: 0,
            hasMoreRowsAfterBatch: false,
          },
        }),
        vendor,
      ),
    ).rejects.toMatchObject({ code: 'P2034' });
    expect(jobStatus).toBe(ImportJobStatus.APPLYING);
    expect(updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: ImportJobStatus.FAILED }),
      }),
    );
  });

  it('retries sync P2034 on the APPLIED transition', async () => {
    let txCalls = 0;
    let finishAttempts = 0;
    let jobStatus: ImportJobStatus = ImportJobStatus.APPLYING;
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        txCalls += 1;
        if (txCalls === 1) {
          const tx = withApplyPersistedTotalsTransactionClient(
            {
              importJob: { update: async () => ({}) },
              importJobRow: { update: jest.fn() },
            },
            { tenantId: 'tenant-1', expectedRows: 1 },
          );
          return fn(tx);
        }
        finishAttempts += 1;
        if (finishAttempts <= 2) {
          throw p2034();
        }
        const tx = withApplyPersistedTotalsTransactionClient(
          {
            importJob: {
              findFirst: async () => ({
                id: 'job-supplier',
                tenant_id: 'tenant-1',
                totals_json: {
                  rows: 1,
                  create: 0,
                  update: 0,
                  skip: 1,
                  error: 0,
                },
              }),
              update: async () => {
                jobStatus = ImportJobStatus.APPLIED;
                return { id: 'job-supplier', status: jobStatus };
              },
              updateMany: async () => ({ count: 1 }),
            },
            importJobRow: { update: jest.fn() },
          },
          {
            tenantId: 'tenant-1',
            expectedRows: 1,
            persistedRows: [{ action: ImportRowAction.SKIP }],
          },
        );
        return fn(tx);
      },
      importJob: {
        updateMany: jest.fn(),
        findFirst: async () => ({ id: 'job-supplier', status: jobStatus }),
        update: jest.fn(),
      },
      importJobRow: { update: jest.fn() },
    };
    const runner = makeRunner(prisma);

    const result = await runner.run(supplierInput([skipRowRow(1)]), vendor);
    expect(result.status).toBe(ImportJobStatus.APPLIED);
    expect(finishAttempts).toBe(3);
  });

  it('throws ImportApplyRetryExhaustedError after persistent row P2034', async () => {
    jest.useFakeTimers();
    const transaction = jest.fn(async () => {
      throw p2034();
    });
    const prisma = {
      $transaction: transaction,
      importJob: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        findFirst: async () => ({
          id: 'job-supplier',
          status: ImportJobStatus.APPLYING,
          options_json: {},
        }),
        update: jest.fn(),
      },
      importJobRow: { update: jest.fn() },
    };
    const runner = makeRunner(prisma);

    const exhausted = expect(
      runner.run(supplierInput([skipRowRow(1)]), vendor),
    ).rejects.toBeInstanceOf(ImportApplyRetryExhaustedError);
    await jest.runAllTimersAsync();
    await exhausted;
    jest.useRealTimers();
    expect(transaction.mock.calls.length).toBeGreaterThanOrEqual(
      IMPORT_SYNC_ROW_TX_MAX_ATTEMPTS,
    );
  }, 30_000);
});
