import { Logger } from '@nestjs/common';
import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
} from '@prisma/client';
import {
  IMPORT_APPLY_BATCH_SIZE,
  IMPORT_WORKER_BATCH_SIZE,
} from './import.constants.js';
import type { ImportApplyRow } from './import-type-handler.js';
import type { ImportJobWorkerState } from './import-job.worker-state.js';
import type { SerializedImportJob } from './import-job.serializer.js';
import type { ImportJobTotals } from './import.types.js';
import { withApplyPersistedTotalsTransactionClient } from './import-apply-persisted-totals.test-util.js';
import { ImportWorkerLeaseLostError } from './import-worker.errors.js';
import {
  createApplyWorker as createWorker,
  emptyTotals,
  makeRowRunner as createRunner,
} from './import-runner.spec.support.js';

const CUSTOMER = ImportEntityType.CUSTOMER;
const noWrite = async () => undefined;

function makeRows(
  count: number,
  action: ImportRowAction,
  startRowNo = 1,
): ImportApplyRow[] {
  return Array.from({ length: count }, (_, index) => ({
    row_no: startRowNo + index,
    action,
    entity_id: null,
    external_id: `ext-${startRowNo + index}`,
    normalized_json: {},
  }));
}

function makeSkipRows(count: number, startRowNo = 1) {
  return makeRows(count, ImportRowAction.SKIP, startRowNo);
}

function applyInput(
  rows: ImportApplyRow[],
  overrides: { totalsJson?: ImportJobTotals; optionsJson?: unknown } = {},
) {
  return {
    tenantId: 'tenant-1',
    job: {
      id: 'job-1',
      source_system: 'legacy',
      options_json: overrides.optionsJson ?? {},
      totals_json: overrides.totalsJson ?? emptyTotals(rows.length),
    },
    rows,
    actorUserId: 'user-1',
    effectiveOptions: {},
    preparation: { vendor: null },
  };
}

function batchOptions(
  resumeAfterApplySeq: number,
  hasMoreRowsAfterBatch: boolean,
) {
  return { resumeAfterApplySeq, stopAfterBatch: true, hasMoreRowsAfterBatch };
}

/**
 * Job fake for stop-after-batch runs: updateMany is the guarded APPLIED write, so
 * appliedUpdates counts how often the job actually reached APPLIED.
 */
function createBatchPrisma(totalRows: number) {
  let jobStatus: ImportJobStatus = ImportJobStatus.APPLYING;
  let appliedTotalsJson: ImportJobTotals | undefined;
  const appliedUpdates: unknown[] = [];
  const storedTotals = () => appliedTotalsJson ?? emptyTotals(totalRows);
  const trackApplied = (data: Record<string, unknown>) => {
    if (data.status === ImportJobStatus.APPLIED) {
      appliedUpdates.push(data);
      jobStatus = ImportJobStatus.APPLIED;
      appliedTotalsJson = data.totals_json as ImportJobTotals;
    }
  };
  const importJob = {
    updateMany: async (args: { data: Record<string, unknown> }) => {
      trackApplied(args.data);
      return { count: 1 };
    },
    findFirst: async () => ({
      id: 'job-1',
      tenant_id: 'tenant-1',
      status: jobStatus,
      totals_json: storedTotals(),
    }),
    update: jest.fn(async (args: { data: Record<string, unknown> }) => ({
      id: 'job-1',
      status: ImportJobStatus.APPLIED,
      totals_json: args.data.totals_json,
    })),
  };
  const importJobRow = { update: jest.fn() };
  const persistedRows = Array.from({ length: totalRows }, () => ({
    action: ImportRowAction.SKIP,
  }));
  return {
    appliedUpdates,
    prisma: {
      externalIdMapping: { findFirst: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<void>) =>
        fn(
          withApplyPersistedTotalsTransactionClient(
            { importJob, importJobRow },
            {
              tenantId: 'tenant-1',
              expectedRows: totalRows,
              persistedRows,
            },
          ),
        ),
      importJob,
      importJobRow,
    },
  };
}

/** Worker fake: the tx importJob.update carries the cursor the row commit persisted. */
function createWorkerPrisma(worker: ImportJobWorkerState, totalRows: number) {
  let jobStatus: ImportJobStatus = ImportJobStatus.APPLYING;
  const appliedUpdates: unknown[] = [];
  const jobTotals = emptyTotals(totalRows);
  const skipCount = Math.min(IMPORT_APPLY_BATCH_SIZE, totalRows);
  const persistedRows = [
    ...Array.from({ length: skipCount }, () => ({
      action: ImportRowAction.SKIP,
    })),
    ...Array.from({ length: totalRows - skipCount }, () => ({
      action: ImportRowAction.ERROR,
    })),
  ];
  const importJobRow = { update: jest.fn() };
  const importJob = {
    updateMany: async (args: { data: Record<string, unknown> }) => {
      if (args.data.totals_json) {
        Object.assign(jobTotals, args.data.totals_json);
      }
      if (args.data.status === ImportJobStatus.APPLIED) {
        appliedUpdates.push(args.data);
        jobStatus = ImportJobStatus.APPLIED;
      }
      return { count: 1 };
    },
    findFirst: async () => ({
      id: 'job-1',
      tenant_id: 'tenant-1',
      status: jobStatus,
      options_json: { worker },
      totals_json: { ...jobTotals },
    }),
    update: async (args: {
      data: {
        status?: ImportJobStatus;
        options_json?: { worker: ImportJobWorkerState };
        totals_json?: Record<string, number>;
      };
    }) => {
      if (args.data.options_json?.worker) {
        Object.assign(worker, args.data.options_json.worker);
      }
      if (args.data.status === ImportJobStatus.APPLIED) {
        jobStatus = ImportJobStatus.APPLIED;
      }
      return {
        id: 'job-1',
        status: jobStatus,
        totals_json: args.data.totals_json,
      };
    },
  };
  return {
    appliedUpdates,
    prisma: {
      externalIdMapping: { findFirst: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<void>) => {
        const tx = withApplyPersistedTotalsTransactionClient(
          { importJob, importJobRow },
          { tenantId: 'tenant-1', expectedRows: totalRows, persistedRows },
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
          totals_json: {},
        }),
        update: jest.fn(),
      },
      importJobRow: { update: jest.fn() },
    },
  };
}

describe('RowByRowApplyRunner batches and job state', () => {
  it('stays APPLYING when the page is full but more rows remain', async () => {
    const totalRows = IMPORT_APPLY_BATCH_SIZE + 1;
    const { prisma, appliedUpdates } = createBatchPrisma(totalRows);
    const runner = createRunner(prisma);

    const firstBatch = await runner.run(
      applyInput(makeSkipRows(IMPORT_APPLY_BATCH_SIZE), {
        totalsJson: emptyTotals(totalRows),
      }),
      CUSTOMER,
      noWrite,
      batchOptions(0, true),
    );

    expect(firstBatch.status).toBe(ImportJobStatus.APPLYING);
    expect(appliedUpdates).toHaveLength(0);
    expect(firstBatch.totals.skip).toBe(IMPORT_APPLY_BATCH_SIZE);

    const secondBatch = await runner.run(
      applyInput(makeSkipRows(1, IMPORT_APPLY_BATCH_SIZE + 1), {
        totalsJson: firstBatch.totals,
      }),
      CUSTOMER,
      noWrite,
      batchOptions(IMPORT_APPLY_BATCH_SIZE, false),
    );

    expect(secondBatch.status).toBe(ImportJobStatus.APPLIED);
    expect(secondBatch.totals.skip).toBe(IMPORT_APPLY_BATCH_SIZE + 1);
    expect(appliedUpdates).toHaveLength(1);
  });

  it('applies more than IMPORT_WORKER_BATCH_SIZE rows across many worker batches', async () => {
    const totalRows = IMPORT_WORKER_BATCH_SIZE + 1;
    const { prisma, appliedUpdates } = createBatchPrisma(totalRows);
    const runner = createRunner(prisma);

    let resumeAfter = 0;
    let totalsJson = emptyTotals(totalRows);
    let lastResult: SerializedImportJob | undefined;

    while (resumeAfter < totalRows) {
      const pageLen = Math.min(IMPORT_APPLY_BATCH_SIZE, totalRows - resumeAfter);
      lastResult = await runner.run(
        applyInput(makeSkipRows(pageLen, resumeAfter + 1), { totalsJson }),
        CUSTOMER,
        noWrite,
        batchOptions(resumeAfter, resumeAfter + pageLen < totalRows),
      );
      totalsJson = lastResult.totals;
      resumeAfter += pageLen;
    }

    expect(lastResult?.status).toBe(ImportJobStatus.APPLIED);
    expect(lastResult?.totals.skip).toBe(totalRows);
    expect(appliedUpdates).toHaveLength(1);
  });

  it('advances past skip and error rows so later batches finish the job', async () => {
    const totalRows = IMPORT_WORKER_BATCH_SIZE + 1;
    const worker = createWorker('lease-1');
    const { prisma, appliedUpdates } = createWorkerPrisma(worker, totalRows);
    const runner = createRunner(prisma);

    let totalsJson = emptyTotals(totalRows);
    let lastResult: SerializedImportJob | undefined;

    while ((worker.last_committed_apply_seq ?? 0) < totalRows) {
      const resumeAfter = worker.last_committed_apply_seq ?? 0;
      const pageLen = Math.min(
        IMPORT_APPLY_BATCH_SIZE,
        totalRows - resumeAfter,
      );
      const action =
        resumeAfter === 0 ? ImportRowAction.SKIP : ImportRowAction.ERROR;
      lastResult = await runner.run(
        applyInput(makeRows(pageLen, action, resumeAfter + 1), {
          totalsJson,
          optionsJson: { worker },
        }),
        CUSTOMER,
        noWrite,
        {
          ...batchOptions(resumeAfter, resumeAfter + pageLen < totalRows),
          leaseToken: worker.lease_token,
        },
      );
      totalsJson = lastResult.totals;
      expect(worker.last_committed_apply_seq).toBe(resumeAfter + pageLen);
    }

    expect(lastResult?.status).toBe(ImportJobStatus.APPLIED);
    expect(lastResult?.totals.skip).toBe(IMPORT_APPLY_BATCH_SIZE);
    expect(lastResult?.totals.error).toBe(
      totalRows - IMPORT_APPLY_BATCH_SIZE,
    );
    expect(worker.last_committed_apply_seq).toBe(totalRows);
    expect(appliedUpdates).toHaveLength(1);
  });

  it('accumulates totals across a partial batch instead of resetting them', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const importJob = {
      updateMany: async (args: { data: Record<string, unknown> }) => {
        updates.push(args.data);
        return { count: 1 };
      },
      findFirst: async () => ({
        id: 'job-1',
        tenant_id: 'tenant-1',
        status: ImportJobStatus.APPLYING,
        totals_json: updates.at(-1) ?? {
          rows: 4,
          create: 2,
          update: 1,
          skip: 0,
          error: 0,
        },
      }),
      update: jest.fn(async (args: { data: Record<string, unknown> }) => ({
        id: 'job-1',
        status: ImportJobStatus.APPLIED,
        totals_json: args.data.totals_json,
      })),
    };
    const importJobRow = { update: jest.fn() };
    const prisma = {
      externalIdMapping: { findFirst: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<void>) =>
        fn(
          withApplyPersistedTotalsTransactionClient(
            { importJob, importJobRow },
            { expectedRows: 4 },
          ),
        ),
      importJob,
      importJobRow,
    };
    const runner = createRunner(prisma);

    const result = await runner.run(
      applyInput(makeSkipRows(2), {
        totalsJson: { rows: 4, create: 2, update: 1, skip: 0, error: 0 },
      }),
      CUSTOMER,
      noWrite,
      batchOptions(0, true),
    );

    expect(result.totals.skip).toBe(2);
    expect(result.totals.create).toBe(2);
    expect(updates[0]?.totals_json).toMatchObject({
      skip: 2,
      create: 2,
      update: 1,
      rows: 4,
    });
  });

  it('logs import.worker.batch_duration_ms for background batches', async () => {
    const logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => {});
    const jobRecord = {
      id: 'job-1',
      status: ImportJobStatus.APPLYING,
      totals_json: {},
      options_json: {
        worker: {
          phase: 'apply',
          lease_token: 'lease',
          lease_until: new Date(Date.now() + 60_000).toISOString(),
          processed_rows: 0,
          last_committed_apply_seq: 0,
          started_at: new Date().toISOString(),
        },
      },
    };
    const tx = withApplyPersistedTotalsTransactionClient(
      {
        importJob: {
          findFirst: async () => jobRecord,
          update: jest.fn(),
        },
        externalIdMapping: { findFirst: async () => null },
        importJobRow: { update: jest.fn() },
      },
      { expectedRows: 1 },
    );
    const prisma = {
      externalIdMapping: { findFirst: async () => null },
      $transaction: async (fn: (innerTx: typeof tx) => Promise<void>) => fn(tx),
      importJob: {
        updateMany: async () => ({ count: 1 }),
        findFirst: async () => jobRecord,
        update: jest.fn(),
      },
      importJobRow: { update: jest.fn() },
    };
    const runner = createRunner(prisma);

    await runner.run(
      applyInput([
        {
          row_no: 1,
          apply_seq: 1,
          action: ImportRowAction.SKIP,
          entity_id: null,
          external_id: 'ext-1',
          normalized_json: {},
        },
      ]),
      CUSTOMER,
      noWrite,
      {
        stopAfterBatch: true,
        useApplySequence: true,
        leaseToken: 'lease',
        maxApplySeq: 1,
        chunkDeadlineMs: Date.now() + 60_000,
      },
    );

    const metricLine = logSpy.mock.calls
      .map((call) => call[0])
      .find(
        (line) =>
          typeof line === 'string' &&
          line.includes('import.worker.batch_duration_ms'),
      );
    expect(metricLine).toBeDefined();
    logSpy.mockRestore();
  });

  it('rethrows lease loss without marking the plan row as ERROR', async () => {
    const rowUpdate = jest.fn();
    const prisma = {
      externalIdMapping: { findFirst: async () => null },
      $transaction: async () => {
        throw new ImportWorkerLeaseLostError();
      },
      importJob: {
        updateMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      importJobRow: { update: rowUpdate },
    };
    const runner = createRunner(prisma);

    await expect(
      runner.run(
        applyInput([
          {
            row_no: 1,
            action: ImportRowAction.CREATE,
            entity_id: null,
            external_id: 'a',
            normalized_json: { external_id: 'a' },
          },
        ]),
        CUSTOMER,
        async () => undefined,
        { stopAfterBatch: true, leaseToken: 'lease-a' },
      ),
    ).rejects.toBeInstanceOf(ImportWorkerLeaseLostError);
    expect(rowUpdate).not.toHaveBeenCalled();
  });
});
