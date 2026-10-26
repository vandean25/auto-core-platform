import { ImportEntityType, ImportJobStatus, ImportRowAction } from '@prisma/client';
import { RowByRowApplyRunner } from './import-row-apply.runner.js';

describe('RowByRowApplyRunner batch totals', () => {
  it('accumulates totals across a partial batch instead of resetting them', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const prisma = {
      externalIdMapping: { findFirst: async () => null },
      $transaction: async (fn: (tx: unknown) => Promise<void>) => fn({}),
      importJob: {
        updateMany: async (args: { data: Record<string, unknown> }) => {
          updates.push(args.data);
          return { count: 1 };
        },
        findFirst: async () => ({
          id: 'job-1',
          status: ImportJobStatus.APPLYING,
          totals_json: updates.at(-1) ?? {},
        }),
      },
      importJobRow: { update: jest.fn() },
    };
    const runner = new RowByRowApplyRunner(
      prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, totals) => ({ ...job, totals, status: job.status }),
    );
    const rows = [
      {
        row_no: 1,
        action: ImportRowAction.SKIP,
        entity_id: null,
        external_id: 'a',
        normalized_json: {},
      },
      {
        row_no: 2,
        action: ImportRowAction.SKIP,
        entity_id: null,
        external_id: 'b',
        normalized_json: {},
      },
    ];
    const result = await runner.run(
      {
        tenantId: 'tenant-1',
        job: {
          id: 'job-1',
          source_system: 'legacy',
          options_json: {},
          totals_json: { rows: 4, create: 0, update: 0, skip: 0, error: 0 },
        },
        rows,
        actorUserId: 'user-1',
        effectiveOptions: {},
        preparation: { vendor: null },
      },
      ImportEntityType.CUSTOMER,
      async () => undefined,
      { resumeAfterRowNo: 0, stopAfterBatch: true },
    );
    expect(result.totals.skip).toBe(2);
    expect(updates[0]?.totals_json).toMatchObject({ skip: 2, rows: 4 });
  });
});
