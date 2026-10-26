import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
} from '@prisma/client';
import { IMPORT_APPLY_BATCH_SIZE } from './import.constants.js';
import type { SerializedImportJob } from './import-job.serializer.js';
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
    let jobStatus = ImportJobStatus.APPLYING;
    const prisma = {
      externalIdMapping: { findFirst: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<void>) => fn({}),
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
        resumeAfterRowNo: 0,
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
        resumeAfterRowNo: IMPORT_APPLY_BATCH_SIZE,
        stopAfterBatch: true,
        hasMoreRowsAfterBatch: false,
      },
    );
    expect(secondBatch.status).toBe(ImportJobStatus.APPLIED);
    expect(secondBatch.totals.skip).toBe(IMPORT_APPLY_BATCH_SIZE + 1);
    expect(appliedUpdates).toHaveLength(1);
  });
});
