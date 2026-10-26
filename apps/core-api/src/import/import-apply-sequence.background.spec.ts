import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
  VehiclePartyRole,
  type Prisma,
} from '@prisma/client';
import type { ImportJobWorkerState } from './import-job.worker-state.js';
import type { SerializedImportJob } from './import-job.serializer.js';
import { RowByRowApplyRunner } from './import-row-apply.runner.js';
import type { ImportApplyInput, ImportApplyRow } from './import-type-handler.js';
import {
  assignVehiclePartyApplySeqs,
  maxApplySeq,
  pageByApplySeq,
} from './import-apply-sequence.test-util.js';
import { buildVehiclePartySixtyRowFixture } from './import-apply-sequence-parity.fixture.js';
import { orderVehiclePartyApplyRows } from './vehicle-party-import.apply-order.js';
import { IMPORT_APPLY_BATCH_SIZE } from './import.constants.js';
import { VehiclePartyImportHandler } from './vehicle-party-import.handler.js';
import { ImportWorkerLeaseLostError } from './import-worker.errors.js';

const VEHICLE_ID = 'veh-1';
const BATCH = 3;

function plannedRow(
  rowNo: number,
  action: ImportRowAction,
  overrides: Record<string, unknown> = {},
): ImportApplyRow {
  return {
    row_no: rowNo,
    action,
    entity_id: action === ImportRowAction.UPDATE ? `party-${rowNo}` : null,
    external_id: `ext-${rowNo}`,
    normalized_json: {
      external_id: `ext-${rowNo}`,
      vehicle_id: VEHICLE_ID,
      customer_id: 'cust-1',
      role: VehiclePartyRole.OWNER,
      valid_from: '2026-01-01',
      valid_to: action === ImportRowAction.UPDATE ? '2026-06-01' : null,
      notes: null,
      ...overrides,
    },
  };
}

function createSequenceWorkerPrisma(
  worker: ImportJobWorkerState,
  initialTotals?: {
    rows: number;
    create: number;
    update: number;
    skip: number;
    error: number;
  },
) {
  let jobStatus: ImportJobStatus = ImportJobStatus.APPLYING;
  const jobTotals = {
    rows: initialTotals?.rows ?? 0,
    create: initialTotals?.create ?? 0,
    update: initialTotals?.update ?? 0,
    skip: initialTotals?.skip ?? 0,
    error: initialTotals?.error ?? 0,
  };
  const tx = {
    importJob: {
      findFirst: async () => ({
        id: 'job-1',
        status: jobStatus,
        options_json: { worker },
        totals_json: { ...jobTotals },
      }),
      update: async (args: {
        data: {
          status?: ImportJobStatus;
          options_json?: { worker: ImportJobWorkerState };
          totals_json?: typeof jobTotals;
        };
      }) => {
        if (args.data.options_json?.worker) {
          Object.assign(worker, args.data.options_json.worker);
        }
        if (args.data.totals_json) {
          Object.assign(jobTotals, args.data.totals_json);
        }
        if (args.data.status === ImportJobStatus.APPLIED) {
          jobStatus = ImportJobStatus.APPLIED;
        }
      },
    },
    importJobRow: { update: jest.fn() },
    vehicleParty: { findFirst: async () => ({ id: 'party' }) },
    externalIdMapping: { findFirst: async () => null },
  };
  return {
    prisma: {
      externalIdMapping: { findFirst: async () => null },
      $transaction: async (
        fn: (client: typeof tx) => Promise<void>,
        _options?: unknown,
      ) => fn(tx),
      importJob: {
        updateMany: jest.fn(),
        findFirst: async () => ({
          id: 'job-1',
          status: jobStatus,
          totals_json: { ...jobTotals },
        }),
        update: jest.fn(async (args: { where: { id: string }; data: { status?: ImportJobStatus } }) => ({
          id: args.where.id,
          status: args.data.status ?? jobStatus,
          totals_json: {},
        })),
      },
      importJobRow: { update: jest.fn() },
    },
    getStatus: () => jobStatus,
  };
}

class TrackingVehiclePartyImportHandler extends VehiclePartyImportHandler {
  readonly applied: Array<{ row_no: number; apply_seq: number }> = [];

  protected override writeRow(
    _tx: Prisma.TransactionClient,
    row: ImportApplyRow,
    _input: ImportApplyInput,
  ): Promise<void> {
    this.applied.push({
      row_no: row.row_no,
      apply_seq: row.apply_seq ?? 0,
    });
    return Promise.resolve();
  }
}

describe('import apply_seq background apply', () => {
  it('matches sync and background write order on a 60-row fixture (batch 50, gap at 51)', async () => {
    const allRows = buildVehiclePartySixtyRowFixture();
    const withSeq = assignVehiclePartyApplySeqs(allRows);
    const maxSeq = maxApplySeq(withSeq);
    const worker: ImportJobWorkerState = {
      phase: 'apply',
      lease_token: 'lease-parity',
      lease_until: new Date(0).toISOString(),
      processed_rows: 0,
      last_committed_apply_seq: 0,
      started_at: new Date().toISOString(),
    };
    const { prisma } = createSequenceWorkerPrisma(worker);
    const runner = new RowByRowApplyRunner(
      prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, totals) =>
        ({ ...job, totals, status: job.status }) as unknown as SerializedImportJob,
    );
    const syncHandler = new TrackingVehiclePartyImportHandler(
      prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      runner,
    );
    const totalsJson = {
      rows: allRows.length,
      create: 0,
      update: 0,
      skip: 0,
      error: 0,
    };
    const syncResult = await syncHandler.apply({
      tenantId: 'tenant-1',
      job: {
        id: 'job-sync',
        source_system: 'legacy',
        options_json: {},
        totals_json: totalsJson,
      },
      rows: allRows,
      actorUserId: 'user-1',
      effectiveOptions: {},
      preparation: { vendor: null },
    });
    const syncWrites = syncHandler.applied.map((row) => row.row_no);

    const bgHandler = new TrackingVehiclePartyImportHandler(
      prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      runner,
    );
    const bgWorker: ImportJobWorkerState = {
      phase: 'apply',
      lease_token: 'lease-bg',
      lease_until: new Date(0).toISOString(),
      processed_rows: 0,
      last_committed_apply_seq: 0,
      started_at: new Date().toISOString(),
    };
    const { prisma: bgPrisma } = createSequenceWorkerPrisma(bgWorker, totalsJson);
    const bgRunner = new RowByRowApplyRunner(
      bgPrisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, totals) =>
        ({ ...job, totals, status: job.status }) as unknown as SerializedImportJob,
    );
    const bgTracking = new TrackingVehiclePartyImportHandler(
      bgPrisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      bgRunner,
    );
    let bgTotals = { ...totalsJson };
    while ((bgWorker.last_committed_apply_seq ?? 0) < maxSeq) {
      const resumeAfter = bgWorker.last_committed_apply_seq ?? 0;
      const peek = pageByApplySeq(
        withSeq,
        resumeAfter,
        IMPORT_APPLY_BATCH_SIZE + 1,
      );
      const page = peek.slice(0, IMPORT_APPLY_BATCH_SIZE);
      const result = await bgTracking.apply({
        tenantId: 'tenant-1',
        job: {
          id: 'job-bg',
          source_system: 'legacy',
          options_json: { worker: bgWorker },
          totals_json: bgTotals,
        },
        rows: page,
        actorUserId: 'user-1',
        effectiveOptions: {},
        preparation: { vendor: null },
        batchOptions: {
          resumeAfterApplySeq: resumeAfter,
          stopAfterBatch: true,
          hasMoreRowsAfterBatch: peek.length > IMPORT_APPLY_BATCH_SIZE,
          useApplySequence: true,
          maxApplySeq: maxSeq,
          leaseToken: bgWorker.lease_token,
        },
      });
      bgTotals = result.totals;
    }
    const bgWrites = bgTracking.applied.map((row) => row.row_no);
    expect(bgWrites).toEqual(syncWrites);
    expect(new Set(bgWrites).size).toBe(bgWrites.length);
    expect(bgWrites).toContain(51);
    expect(bgTotals).toEqual(syncResult.totals);
  });

  it('applies every row across batch size 3 without skipping the gap row', async () => {
    const worker: ImportJobWorkerState = {
      phase: 'apply',
      lease_token: 'lease-seq',
      lease_until: new Date(0).toISOString(),
      processed_rows: 0,
      last_committed_apply_seq: 0,
      started_at: new Date().toISOString(),
    };
    const { prisma } = createSequenceWorkerPrisma(worker);
    const runner = new RowByRowApplyRunner(
      prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, totals) =>
        ({ ...job, totals, status: job.status }) as unknown as SerializedImportJob,
    );
    const handler = new TrackingVehiclePartyImportHandler(
      prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      runner,
    );
    const allRows = assignVehiclePartyApplySeqs([
      plannedRow(1, ImportRowAction.SKIP),
      plannedRow(2, ImportRowAction.SKIP),
      plannedRow(3, ImportRowAction.CREATE),
      plannedRow(4, ImportRowAction.CREATE, { vehicle_id: 'other' }),
      plannedRow(5, ImportRowAction.UPDATE),
    ]);
    const maxSeq = maxApplySeq(allRows);
    const totalsJson = {
      rows: allRows.length,
      create: 0,
      update: 0,
      skip: 0,
      error: 0,
    };

    while ((worker.last_committed_apply_seq ?? 0) < maxSeq) {
      const resumeAfter = worker.last_committed_apply_seq ?? 0;
      const peek = pageByApplySeq(allRows, resumeAfter, BATCH + 1);
      const page = peek.slice(0, BATCH);
      await handler.apply({
        tenantId: 'tenant-1',
        job: {
          id: 'job-1',
          source_system: 'legacy',
          options_json: { worker },
          totals_json: totalsJson,
        },
        rows: page,
        actorUserId: 'user-1',
        effectiveOptions: {},
        preparation: { vendor: null },
        batchOptions: {
          resumeAfterApplySeq: resumeAfter,
          stopAfterBatch: true,
          hasMoreRowsAfterBatch: peek.length > BATCH,
          useApplySequence: true,
          maxApplySeq: maxSeq,
          leaseToken: worker.lease_token,
        },
      });
    }

    const expectedWriteOrder = orderVehiclePartyApplyRows(allRows)
      .filter((row) => row.action !== ImportRowAction.SKIP)
      .map((row) => row.row_no);
    expect(handler.applied.map((row) => row.row_no)).toEqual(expectedWriteOrder);
    expect(handler.applied.map((row) => row.row_no)).toContain(4);
    expect(
      handler.applied.findIndex((row) => row.row_no === 5),
    ).toBeLessThan(handler.applied.findIndex((row) => row.row_no === 3));
  });

  it('does not advance the cursor when writeRow loses the lease', async () => {
    const worker: ImportJobWorkerState = {
      phase: 'apply',
      lease_token: 'lease-loss',
      lease_until: new Date(0).toISOString(),
      processed_rows: 0,
      last_committed_apply_seq: 0,
      started_at: new Date().toISOString(),
    };
    const { prisma } = createSequenceWorkerPrisma(worker);
    const runner = new RowByRowApplyRunner(
      prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, totals) =>
        ({ ...job, totals, status: job.status }) as unknown as SerializedImportJob,
    );
    const rows = assignVehiclePartyApplySeqs([
      plannedRow(1, ImportRowAction.UPDATE),
      plannedRow(2, ImportRowAction.CREATE),
    ]);
    await expect(
      runner.run(
        {
          tenantId: 'tenant-1',
          job: {
            id: 'job-1',
            source_system: 'legacy',
            options_json: { worker },
            totals_json: { rows: 2, create: 0, update: 0, skip: 0, error: 0 },
          },
          rows,
          actorUserId: 'user-1',
          effectiveOptions: {},
          preparation: { vendor: null },
        },
        ImportEntityType.VEHICLE_PARTY,
        async () => {
          throw new ImportWorkerLeaseLostError();
        },
        {
          stopAfterBatch: true,
          useApplySequence: true,
          maxApplySeq: 2,
          leaseToken: worker.lease_token,
        },
      ),
    ).rejects.toBeInstanceOf(ImportWorkerLeaseLostError);
    expect(worker.last_committed_apply_seq).toBe(0);
  });

  it('marks APPLIED only after the last apply_seq commits', async () => {
    const worker: ImportJobWorkerState = {
      phase: 'apply',
      lease_token: 'lease-done',
      lease_until: new Date(0).toISOString(),
      processed_rows: 0,
      last_committed_apply_seq: 0,
      started_at: new Date().toISOString(),
    };
    const { prisma, getStatus } = createSequenceWorkerPrisma(worker);
    const runner = new RowByRowApplyRunner(
      prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, totals) =>
        ({ ...job, totals, status: job.status }) as unknown as SerializedImportJob,
    );
    const rows = assignVehiclePartyApplySeqs([
      plannedRow(1, ImportRowAction.UPDATE),
      plannedRow(2, ImportRowAction.CREATE),
    ]);
    expect(getStatus()).toBe(ImportJobStatus.APPLYING);
    await runner.run(
      {
        tenantId: 'tenant-1',
        job: {
          id: 'job-1',
          source_system: 'legacy',
          options_json: { worker },
          totals_json: { rows: 2, create: 0, update: 0, skip: 0, error: 0 },
        },
        rows,
        actorUserId: 'user-1',
        effectiveOptions: {},
        preparation: { vendor: null },
      },
      ImportEntityType.VEHICLE_PARTY,
      async () => undefined,
      {
        stopAfterBatch: true,
        useApplySequence: true,
        maxApplySeq: 2,
        leaseToken: worker.lease_token,
      },
    );
    expect(worker.last_committed_apply_seq).toBe(2);
    expect(getStatus()).toBe(ImportJobStatus.APPLIED);
  });

  it('resumes after lease loss without duplicating committed rows', async () => {
    const worker: ImportJobWorkerState = {
      phase: 'apply',
      lease_token: 'lease-resume',
      lease_until: new Date(0).toISOString(),
      processed_rows: 0,
      last_committed_apply_seq: 0,
      started_at: new Date().toISOString(),
    };
    const { prisma } = createSequenceWorkerPrisma(worker);
    const rows = assignVehiclePartyApplySeqs([
      plannedRow(1, ImportRowAction.UPDATE),
      plannedRow(2, ImportRowAction.CREATE),
      plannedRow(3, ImportRowAction.CREATE),
    ]);
    const maxSeq = maxApplySeq(rows);
    const applied: number[] = [];
    let failRow2Once = true;
    const runner = new RowByRowApplyRunner(
      prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, totals) =>
        ({ ...job, totals, status: job.status }) as unknown as SerializedImportJob,
    );
    const applyBatch = async () => {
      const resumeAfter = worker.last_committed_apply_seq ?? 0;
      const page = pageByApplySeq(rows, resumeAfter, 10);
      await runner.run(
        {
          tenantId: 'tenant-1',
          job: {
            id: 'job-1',
            source_system: 'legacy',
            options_json: { worker },
            totals_json: { rows: 3, create: 0, update: 0, skip: 0, error: 0 },
          },
          rows: page,
          actorUserId: 'user-1',
          effectiveOptions: {},
          preparation: { vendor: null },
        },
        ImportEntityType.VEHICLE_PARTY,
        async (_tx, row) => {
          if (row.row_no === 2 && failRow2Once) {
            failRow2Once = false;
            throw new ImportWorkerLeaseLostError();
          }
          applied.push(row.row_no);
        },
        {
          stopAfterBatch: true,
          useApplySequence: true,
          maxApplySeq: maxSeq,
          leaseToken: worker.lease_token,
        },
      );
    };
    await expect(applyBatch()).rejects.toBeInstanceOf(ImportWorkerLeaseLostError);
    expect(worker.last_committed_apply_seq).toBe(1);
    expect(applied).toEqual([1]);
    await applyBatch();
    expect(worker.last_committed_apply_seq).toBe(maxSeq);
    expect(applied).toEqual([1, 2, 3]);
  });

  it('does not mark APPLIED when the worker page is empty', async () => {
    const worker: ImportJobWorkerState = {
      phase: 'apply',
      lease_token: 'lease-empty',
      lease_until: new Date(0).toISOString(),
      processed_rows: 0,
      last_committed_apply_seq: 2,
      started_at: new Date().toISOString(),
    };
    const { prisma, getStatus } = createSequenceWorkerPrisma(worker);
    const runner = new RowByRowApplyRunner(
      prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, totals) =>
        ({ ...job, totals, status: job.status }) as unknown as SerializedImportJob,
    );
    await runner.run(
      {
        tenantId: 'tenant-1',
        job: {
          id: 'job-1',
          source_system: 'legacy',
          options_json: { worker },
          totals_json: { rows: 2, create: 0, update: 0, skip: 0, error: 0 },
        },
        rows: [],
        actorUserId: 'user-1',
        effectiveOptions: {},
        preparation: { vendor: null },
      },
      ImportEntityType.VEHICLE_PARTY,
      async () => undefined,
      {
        stopAfterBatch: true,
        hasMoreRowsAfterBatch: false,
        useApplySequence: true,
        maxApplySeq: 2,
        leaseToken: worker.lease_token,
      },
    );
    expect(getStatus()).toBe(ImportJobStatus.APPLYING);
  });
});
