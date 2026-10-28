import { ImportEntityType, ImportJobStatus, ImportRowAction } from '@prisma/client';
import { ImportJobStore } from './import-job.store.js';
import { withApplyPersistedTotalsTransactionClient } from './import-apply-persisted-totals.test-util.js';
import { RowByRowApplyRunner } from './import-row-apply.runner.js';
import type { ImportApplyRow } from './import-type-handler.js';
import type { SerializedImportJob } from './import-job.serializer.js';

describe('legacy apply resume', () => {
  it('keeps a saved cursor when a FAILED job is locked again', async () => {
    const saved: {
      worker: {
        last_committed_apply_seq: number;
        processed_rows: number;
        lease_token: string;
      } | null;
    } = { worker: null };
    const updateMany = jest.fn(async (args: { data: { options_json: { worker: NonNullable<typeof saved.worker> } } }) => {
      saved.worker = args.data.options_json.worker;
      return { count: 1 };
    });
    const db: {
      client?: {
        importJob: {
          findFirst: () => Promise<unknown>;
          updateMany: typeof updateMany;
        };
        $transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
      };
    } = {};
    db.client = {
      importJob: {
        findFirst: async () => ({
          options_json: {
            worker: {
              phase: 'apply',
              lease_token: 'old-token',
              lease_until: new Date(0).toISOString(),
              processed_rows: 7,
              last_committed_apply_seq: 7,
              started_at: '2026-10-01T00:00:00.000Z',
            },
          },
        }),
        updateMany,
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(db.client),
    };
    const prisma = db.client;
    const store = new ImportJobStore(prisma as never);
    await store.lockForApply('tenant-1', 'job-1');
    expect(saved.worker?.last_committed_apply_seq).toBe(7);
    expect(saved.worker?.processed_rows).toBe(7);
    expect(saved.worker?.lease_token).not.toBe('old-token');
  });

  it('counts rows this job already wrote and does not write them again', async () => {
    const written: number[] = [];
    const rows: ImportApplyRow[] = [1, 2].map((rowNo) => ({
      row_no: rowNo,
      action: ImportRowAction.CREATE,
      entity_id: null,
      external_id: `ext-${rowNo}`,
      normalized_json: { external_id: `ext-${rowNo}` },
    }));
    const actions = new Map<number, ImportRowAction>([
      [1, ImportRowAction.CREATE],
      [2, ImportRowAction.CREATE],
    ]);
    const tx = withApplyPersistedTotalsTransactionClient(
      {
        externalIdMapping: {
          findFirst: async ({ where }: { where: { external_id?: string } }) =>
            where.external_id === 'ext-1'
              ? { first_seen_import_job_id: 'job-1' }
              : null,
        },
        importJob: {
          update: jest.fn(
            async ({ data }: { data: { totals_json: unknown } }) => ({
              id: 'job-1',
              status: ImportJobStatus.APPLIED,
              totals_json: data.totals_json,
              options_json: {},
              createdAt: new Date(),
              appliedAt: new Date(),
              entity_type: ImportEntityType.VEHICLE_PARTY,
              source_system: 'legacy',
              file_name: 'parties.csv',
              file_sha256: 'abc',
              mapping_json: {},
              created_by: null,
            }),
          ),
        },
        importJobRow: {
          findFirst: async () => null,
          update: jest.fn(),
        },
      },
      { expectedRows: 2, actionsByRow: actions },
    );
    const prisma = {
      externalIdMapping: tx.externalIdMapping,
      importJobRow: tx.importJobRow,
      importJob: tx.importJob,
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>) =>
        fn(tx),
    };
    const serialized: SerializedImportJob[] = [];
    const runner = new RowByRowApplyRunner(
      prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, totals) => {
        const view = {
          id: job.id,
          status: job.status,
          totals,
        } as SerializedImportJob;
        serialized.push(view);
        return view;
      },
    );
    await runner.run(
      {
        tenantId: 'tenant-1',
        job: {
          id: 'job-1',
          entity_type: ImportEntityType.VEHICLE_PARTY,
          source_system: 'legacy',
          options_json: {},
          totals_json: { rows: 2, create: 2, update: 0, skip: 0, error: 0 },
        } as never,
        rows,
        actorUserId: 'actor',
        effectiveOptions: {},
        preparation: { vendor: null },
      },
      ImportEntityType.VEHICLE_PARTY,
      async (_tx, row) => {
        written.push(row.row_no);
      },
    );
    expect(written).toEqual([2]);
    expect(actions.get(1)).toBe(ImportRowAction.CREATE);
    expect(serialized.at(-1)?.totals).toMatchObject({
      create: 2,
      error: 0,
    });
  });
});
