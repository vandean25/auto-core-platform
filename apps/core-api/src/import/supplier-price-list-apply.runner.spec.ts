import { ImportJobStatus, ImportRowAction } from '@prisma/client';
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
import { withApplyPersistedTotalsTransactionClient } from './import-apply-persisted-totals.test-util.js';
import {
  createApplyWorker as backgroundWorker,
  makeSupplierRunner as makeRunner,
  p2034,
} from './import-runner.spec.support.js';

const vendor = { id: 'vendor-1', name: 'Vendor' };

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

  it('applies a chunk of N supplier rows with batched reads and writes (query count does not scale per-row for reads/history/creates)', async () => {
    const updateCount = 15;
    const createCount = 10;
    const totalRows = updateCount + createCount;
    const worker = backgroundWorker('lease-batch');
    const catalogItemFindMany = jest.fn(async () =>
      Array.from({ length: updateCount }, (_, idx) => ({
        id: `item-${idx + 1}`,
        cost_price: 10,
        retail_price: 20,
      })),
    );
    const catalogItemCreateManyAndReturn = jest.fn(async () =>
      Array.from({ length: createCount }, (_, idx) => ({
        id: `created-${idx + 1}`,
        sku: `NEW-${idx + 1}`,
      })),
    );
    const catalogItemUpdate = jest.fn(async () => ({}));
    const vendorArticleFindMany = jest.fn(async () => []);
    const vendorArticleCreateMany = jest.fn(async () => ({
      count: totalRows,
    }));
    const catalogPriceHistoryCreateMany = jest.fn(async () => ({
      count: totalRows,
    }));
    const importJobRowUpdate = jest.fn(async () => ({}));
    const importJobUpdate = jest.fn(async () => ({
      id: 'job-supplier',
      status: ImportJobStatus.APPLIED,
    }));

    const rows: ImportApplyRow[] = [
      ...Array.from({ length: updateCount }, (_, idx) => ({
        row_no: idx + 1,
        apply_seq: idx + 1,
        action: ImportRowAction.UPDATE,
        entity_id: `item-${idx + 1}`,
        external_id: `UPD-${idx + 1}`,
        normalized_json: {
          supplier_article_no: `UPD-${idx + 1}`,
          cost_price: 12,
          retail_price: 24,
          rrp: 30,
          old_cost: 10,
          old_retail: 20,
        },
      })),
      ...Array.from({ length: createCount }, (_, idx) => ({
        row_no: updateCount + idx + 1,
        apply_seq: updateCount + idx + 1,
        action: ImportRowAction.CREATE,
        entity_id: null,
        external_id: `NEW-${idx + 1}`,
        normalized_json: {
          supplier_article_no: `NEW-${idx + 1}`,
          description: `Part ${idx + 1}`,
          cost_price: 15,
          retail_price: 25,
          rrp: 30,
        },
      })),
    ];

    let jobStatus: ImportJobStatus = ImportJobStatus.APPLYING;
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(
          withApplyPersistedTotalsTransactionClient(
            {
              catalogItem: {
                findMany: catalogItemFindMany,
                createManyAndReturn: catalogItemCreateManyAndReturn,
                update: catalogItemUpdate,
              },
              vendorArticle: {
                findMany: vendorArticleFindMany,
                createMany: vendorArticleCreateMany,
              },
              catalogPriceHistory: {
                createMany: catalogPriceHistoryCreateMany,
              },
              importJobRow: { update: importJobRowUpdate },
              importJob: {
                findFirst: async () => ({
                  id: 'job-supplier',
                  tenant_id: 'tenant-1',
                  status: jobStatus,
                  options_json: { worker },
                  totals_json: {
                    rows: totalRows,
                    create: createCount,
                    update: updateCount,
                    skip: 0,
                    error: 0,
                  },
                }),
                update: importJobUpdate,
                updateMany: async (args: { data: Record<string, unknown> }) => {
                  if (args.data.status === ImportJobStatus.APPLIED) {
                    jobStatus = ImportJobStatus.APPLIED;
                  }
                  return { count: 1 };
                },
              },
            },
            {
              tenantId: 'tenant-1',
              expectedRows: totalRows,
              persistedRows: rows.map((r) => ({ action: r.action })),
            },
          ),
        ),
      importJob: {
        findFirst: async () => ({
          id: 'job-supplier',
          status: jobStatus,
          totals_json: {
            rows: totalRows,
            create: createCount,
            update: updateCount,
            skip: 0,
            error: 0,
          },
        }),
      },
      auditLog: { create: jest.fn() },
    };

    const runner = makeRunner(prisma);
    const result = await runner.run(
      supplierInput(rows, {
        batchOptions: {
          stopAfterBatch: true,
          leaseToken: 'lease-batch',
        },
      }),
      vendor,
    );

    expect(result.status).toBe(ImportJobStatus.APPLIED);
    expect(catalogItemFindMany).toHaveBeenCalledTimes(1);
    expect(vendorArticleFindMany).toHaveBeenCalledTimes(1);
    expect(catalogItemCreateManyAndReturn).toHaveBeenCalledTimes(1);
    expect(catalogPriceHistoryCreateMany).toHaveBeenCalledTimes(1);
    expect(vendorArticleCreateMany).toHaveBeenCalledTimes(1);
    expect(catalogItemUpdate).toHaveBeenCalledTimes(updateCount);
    expect(importJobRowUpdate).toHaveBeenCalledTimes(createCount);
    // Worker cursor committed once for the chunk, not once per row
    expect(importJobUpdate).toHaveBeenCalledTimes(1);
  });

  it('falls back to row-by-row when a row fails mid-batch, applying valid neighbours and marking only the failing row ERROR', async () => {
    const rows: ImportApplyRow[] = [
      {
        row_no: 1,
        action: ImportRowAction.UPDATE,
        entity_id: 'item-1',
        external_id: 'UPD-1',
        normalized_json: {
          supplier_article_no: 'UPD-1',
          cost_price: 12,
          retail_price: 24,
          old_cost: 10,
          old_retail: 20,
        },
      },
      {
        row_no: 2,
        action: ImportRowAction.UPDATE,
        entity_id: 'item-stale',
        external_id: 'UPD-STALE',
        normalized_json: {
          supplier_article_no: 'UPD-STALE',
          cost_price: 12,
          retail_price: 24,
          old_cost: 10,
          old_retail: 20,
        },
      },
      {
        row_no: 3,
        action: ImportRowAction.UPDATE,
        entity_id: 'item-3',
        external_id: 'UPD-3',
        normalized_json: {
          supplier_article_no: 'UPD-3',
          cost_price: 30,
          retail_price: 50,
          old_cost: 20,
          old_retail: 40,
        },
      },
    ];

    const catalogItems: Record<
      string,
      { id: string; cost_price: number; retail_price: number }
    > = {
      'item-1': { id: 'item-1', cost_price: 10, retail_price: 20 },
      'item-3': { id: 'item-3', cost_price: 20, retail_price: 40 },
    };
    const importJobRowUpdate = jest.fn(async () => ({}));
    const catalogItemUpdate = jest.fn(async () => ({}));
    const vendorArticleUpsert = jest.fn(async () => ({}));
    const catalogPriceHistoryCreate = jest.fn(async () => ({}));
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(
          withApplyPersistedTotalsTransactionClient(
            {
              catalogItem: {
                findMany: async () => Object.values(catalogItems),
                findFirst: async (args: { where: { id: string } }) =>
                  catalogItems[args.where.id] ?? null,
                update: catalogItemUpdate,
              },
              vendorArticle: {
                findMany: async () => [],
                findFirst: async () => null,
                upsert: vendorArticleUpsert,
              },
              catalogPriceHistory: {
                create: catalogPriceHistoryCreate,
              },
              importJob: {
                findFirst: async () => ({
                  id: 'job-supplier',
                  tenant_id: 'tenant-1',
                  status: ImportJobStatus.APPLYING,
                  options_json: {},
                }),
                update: async (args: { data: Record<string, unknown> }) => ({
                  id: 'job-supplier',
                  status: ImportJobStatus.APPLIED,
                  totals_json: args.data.totals_json,
                }),
              },
            },
            {
              tenantId: 'tenant-1',
              expectedRows: 3,
              persistedRows: [
                { action: ImportRowAction.UPDATE },
                { action: ImportRowAction.ERROR },
                { action: ImportRowAction.UPDATE },
              ],
            },
          ),
        ),
      importJob: {
        findFirst: async () => ({
          id: 'job-supplier',
          status: ImportJobStatus.APPLIED,
          totals_json: { rows: 3, create: 0, update: 2, skip: 0, error: 1 },
        }),
      },
      importJobRow: { update: importJobRowUpdate },
      auditLog: { create: jest.fn() },
    };

    const runner = makeRunner(prisma);
    const result = await runner.run(supplierInput(rows), vendor);

    expect(result.status).toBe(ImportJobStatus.APPLIED);
    expect(result.totals).toEqual({
      rows: 3,
      create: 0,
      update: 2,
      skip: 0,
      error: 1,
    });
    expect(catalogItemUpdate).toHaveBeenCalledTimes(2);
    expect(importJobRowUpdate).toHaveBeenCalledWith({
      where: {
        tenant_id_import_job_id_row_no: {
          tenant_id: 'tenant-1',
          import_job_id: 'job-supplier',
          row_no: 2,
        },
      },
      data: {
        action: ImportRowAction.ERROR,
        errors_json: [
          expect.objectContaining({
            code: 'IMPORT_ROW_STALE',
          }),
        ],
      },
    });
  });
});
