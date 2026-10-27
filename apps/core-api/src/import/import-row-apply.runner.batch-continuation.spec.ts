import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
} from '@prisma/client';
import {
  IMPORT_APPLY_BATCH_SIZE,
  IMPORT_WORKER_BATCH_SIZE,
} from './import.constants.js';
import type { SerializedImportJob } from './import-job.serializer.js';
import { withApplyPersistedTotalsTransactionClient } from './import-apply-persisted-totals.test-util.js';
import { RowByRowApplyRunner } from './import-row-apply.runner.js';

function makeSkipRows(count: number, startRowNo = 1) {
  return Array.from({ length: count }, (_, index) => ({
    row_no: startRowNo + index,
    action: ImportRowAction.SKIP,
    entity_id: null,
    external_id: `ext-${startRowNo + index}`,
    normalized_json: {},
  }));
}

describe('RowByRowApplyRunner background batch continuation', () => {
  it('stays APPLYING when the page is full but more rows remain', async () => {
    const appliedUpdates: unknown[] = [];
    let jobStatus: ImportJobStatus = ImportJobStatus.APPLYING;
    const totalRows = IMPORT_APPLY_BATCH_SIZE + 1;
    const importJob = {
      updateMany: async (args: { data: Record<string, unknown> }) => {
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
        totals_json: { rows: totalRows, create: 0, update: 0, skip: 0, error: 0 },
      }),
      update: jest.fn(async (args: { data: Record<string, unknown> }) => ({
        id: 'job-1',
        status: ImportJobStatus.APPLIED,
        totals_json: args.data.totals_json,
      })),
    };
    const importJobRow = {
      update: jest.fn(),
      groupBy: async () => [
        {
          action: ImportRowAction.SKIP,
          _count: { _all: totalRows },
        },
      ],
    };
    const prisma = {
      externalIdMapping: { findFirst: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<void>) =>
        fn(
          withApplyPersistedTotalsTransactionClient(
            { importJob, importJobRow },
            { expectedRows: totalRows },
          ),
        ),
      importJob,
      importJobRow,
    };
    const runner = new RowByRowApplyRunner(
      prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, totals) =>
        ({ ...job, totals, status: job.status }) as unknown as SerializedImportJob,
    );
    const fullPage = makeSkipRows(IMPORT_APPLY_BATCH_SIZE);
    const firstBatch = await runner.run(
      {
        tenantId: 'tenant-1',
        job: {
          id: 'job-1',
          source_system: 'legacy',
          options_json: {},
          totals_json: {
            rows: IMPORT_APPLY_BATCH_SIZE + 1,
            create: 0,
            update: 0,
            skip: 0,
            error: 0,
          },
        },
        rows: fullPage,
        actorUserId: 'user-1',
        effectiveOptions: {},
        preparation: { vendor: null },
      },
      ImportEntityType.CUSTOMER,
      async () => undefined,
      {
        resumeAfterApplySeq: 0,
        stopAfterBatch: true,
        hasMoreRowsAfterBatch: true,
      },
    );
    expect(firstBatch.status).toBe(ImportJobStatus.APPLYING);
    expect(appliedUpdates).toHaveLength(0);
    expect(firstBatch.totals.skip).toBe(IMPORT_APPLY_BATCH_SIZE);

    const tail = makeSkipRows(1, IMPORT_APPLY_BATCH_SIZE + 1);
    const secondBatch = await runner.run(
      {
        tenantId: 'tenant-1',
        job: {
          id: 'job-1',
          source_system: 'legacy',
          options_json: {},
          totals_json: firstBatch.totals,
        },
        rows: tail,
        actorUserId: 'user-1',
        effectiveOptions: {},
        preparation: { vendor: null },
      },
      ImportEntityType.CUSTOMER,
      async () => undefined,
      {
        resumeAfterApplySeq: IMPORT_APPLY_BATCH_SIZE,
        stopAfterBatch: true,
        hasMoreRowsAfterBatch: false,
      },
    );
    expect(secondBatch.status).toBe(ImportJobStatus.APPLIED);
    expect(secondBatch.totals.skip).toBe(IMPORT_APPLY_BATCH_SIZE + 1);
    expect(appliedUpdates).toHaveLength(1);
  });

  it('applies more than IMPORT_WORKER_BATCH_SIZE rows across many worker batches', async () => {
    const totalRows = IMPORT_WORKER_BATCH_SIZE + 1;
    const appliedUpdates: unknown[] = [];
    let jobStatus: ImportJobStatus = ImportJobStatus.APPLYING;
    const importJob = {
      updateMany: async (args: { data: Record<string, unknown> }) => {
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
        totals_json: { rows: totalRows, create: 0, update: 0, skip: 0, error: 0 },
      }),
      update: jest.fn(async (args: { data: Record<string, unknown> }) => ({
        id: 'job-1',
        status: ImportJobStatus.APPLIED,
        totals_json: args.data.totals_json,
      })),
    };
    const importJobRow = {
      update: jest.fn(),
      groupBy: async () => [
        {
          action: ImportRowAction.SKIP,
          _count: { _all: totalRows },
        },
      ],
    };
    const prisma = {
      externalIdMapping: { findFirst: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<void>) =>
        fn(
          withApplyPersistedTotalsTransactionClient(
            { importJob, importJobRow },
            { expectedRows: totalRows },
          ),
        ),
      importJob,
      importJobRow,
    };
    const runner = new RowByRowApplyRunner(
      prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, totals) =>
        ({ ...job, totals, status: job.status }) as unknown as SerializedImportJob,
    );

    let resumeAfter = 0;
    let totalsJson = {
      rows: totalRows,
      create: 0,
      update: 0,
      skip: 0,
      error: 0,
    };
    let lastResult: SerializedImportJob | undefined;

    while (resumeAfter < totalRows) {
      const batchStart = resumeAfter + 1;
      const remaining = totalRows - resumeAfter;
      const pageLen = Math.min(IMPORT_APPLY_BATCH_SIZE, remaining);
      const page = makeSkipRows(pageLen, batchStart);
      const hasMoreRowsAfterBatch = resumeAfter + pageLen < totalRows;
      lastResult = await runner.run(
        {
          tenantId: 'tenant-1',
          job: {
            id: 'job-1',
            source_system: 'legacy',
            options_json: {},
            totals_json: totalsJson,
          },
          rows: page,
          actorUserId: 'user-1',
          effectiveOptions: {},
          preparation: { vendor: null },
        },
        ImportEntityType.CUSTOMER,
        async () => undefined,
        {
          resumeAfterApplySeq: resumeAfter,
          stopAfterBatch: true,
          hasMoreRowsAfterBatch,
        },
      );
      totalsJson = lastResult.totals;
      resumeAfter += pageLen;
    }

    expect(lastResult?.status).toBe(ImportJobStatus.APPLIED);
    expect(lastResult?.totals.skip).toBe(totalRows);
    expect(appliedUpdates).toHaveLength(1);
  });
});
