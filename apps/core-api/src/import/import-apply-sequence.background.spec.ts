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
import { orderVehiclePartyApplyRows } from './vehicle-party-import.apply-order.js';
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

function createSequenceWorkerPrisma(worker: ImportJobWorkerState) {
  let jobStatus: ImportJobStatus = ImportJobStatus.APPLYING;
  const tx = {
    importJob: {
      findFirst: async () => ({
        id: 'job-1',
        status: ImportJobStatus.APPLYING,
        options_json: { worker },
        totals_json: {},
      }),
      update: async (args: {
        data: {
          status?: ImportJobStatus;
          options_json?: { worker: ImportJobWorkerState };
          totals_json?: unknown;
        };
      }) => {
        if (args.data.options_json?.worker) {
          Object.assign(worker, args.data.options_json.worker);
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
          totals_json: {},
        }),
        update: jest.fn(),
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
  it('matches synchronous vehicle-party order including gap rows', () => {
    const fileRows = [
      plannedRow(1, ImportRowAction.SKIP),
      plannedRow(2, ImportRowAction.SKIP),
      plannedRow(3, ImportRowAction.CREATE),
      plannedRow(4, ImportRowAction.CREATE, { vehicle_id: 'other' }),
      plannedRow(5, ImportRowAction.UPDATE),
    ];
    const withSeq = assignVehiclePartyApplySeqs(fileRows);
    const syncOrder = orderVehiclePartyApplyRows(fileRows).map((r) => r.row_no);
    const seqOrder = [...withSeq]
      .sort((a, b) => (a.apply_seq ?? 0) - (b.apply_seq ?? 0))
      .map((r) => r.row_no);
    expect(seqOrder).toEqual(syncOrder);
    expect(seqOrder.indexOf(5)).toBeLessThan(seqOrder.indexOf(3));
    expect(seqOrder).toContain(4);
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
});
