import {
  ImportJobStatus,
  ImportRowAction,
  VehiclePartyRole,
  type Prisma,
} from '@prisma/client';
import { IMPORT_APPLY_BATCH_SIZE } from './import.constants.js';
import type { ImportJobWorkerState } from './import-job.worker-state.js';
import type { SerializedImportJob } from './import-job.serializer.js';
import { RowByRowApplyRunner } from './import-row-apply.runner.js';
import type { ImportApplyInput, ImportApplyRow } from './import-type-handler.js';
import { VehiclePartyImportHandler } from './vehicle-party-import.handler.js';

const VEHICLE_ID = 'veh-tenant-uuid-1';

function plannedRow(
  rowNo: number,
  action: ImportRowAction,
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
    },
  };
}

function createWorkerPrisma(worker: ImportJobWorkerState) {
  let jobStatus: ImportJobStatus = ImportJobStatus.APPLYING;
  const tx = {
    importJob: {
      findFirst: async () => ({
        id: 'job-1',
        status: ImportJobStatus.APPLYING,
        options_json: { worker },
      }),
      update: async (args: {
        data: { options_json?: { worker: ImportJobWorkerState } };
      }) => {
        if (args.data.options_json?.worker) {
          Object.assign(worker, args.data.options_json.worker);
        }
      },
    },
    vehicleParty: { findFirst: async () => ({ id: 'party' }) },
    externalIdMapping: { findFirst: async () => null },
  };
  return {
    prisma: {
      externalIdMapping: { findFirst: async () => null },
      $transaction: async (fn: (client: typeof tx) => Promise<void>) => fn(tx),
      importJob: {
        updateMany: async (args: { data: Record<string, unknown> }) => {
          if (args.data.status === ImportJobStatus.APPLIED) {
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

class TrackingVehiclePartyImportHandler extends VehiclePartyImportHandler {
  readonly applied: Array<{ row_no: number; action: ImportRowAction }> = [];

  protected override writeRow(
    _tx: Prisma.TransactionClient,
    row: ImportApplyRow,
    _input: ImportApplyInput,
  ): Promise<void> {
    this.applied.push({ row_no: row.row_no, action: row.action });
    return Promise.resolve();
  }
}

describe('VehiclePartyImportHandler owner transfer across batches', () => {
  it('applies a full 50-row page with a peeked closing update before the create', async () => {
    const worker: ImportJobWorkerState = {
      phase: 'apply',
      lease_token: 'lease-party',
      lease_until: new Date(0).toISOString(),
      processed_rows: 0,
      last_committed_row_no: 0,
      started_at: new Date().toISOString(),
    };
    const { prisma } = createWorkerPrisma(worker);
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

    const fileBatch = Array.from({ length: IMPORT_APPLY_BATCH_SIZE }, (_, index) =>
      plannedRow(index + 1, ImportRowAction.SKIP),
    );
    fileBatch[IMPORT_APPLY_BATCH_SIZE - 1] = plannedRow(
      IMPORT_APPLY_BATCH_SIZE,
      ImportRowAction.CREATE,
    );
    const lookahead = [
      plannedRow(IMPORT_APPLY_BATCH_SIZE + 1, ImportRowAction.UPDATE),
    ];

    await handler.apply({
      tenantId: 'tenant-1',
      job: {
        id: 'job-1',
        source_system: 'legacy',
        options_json: { worker },
        totals_json: {
          rows: IMPORT_APPLY_BATCH_SIZE + 1,
          create: 0,
          update: 0,
          skip: 0,
          error: 0,
        },
      },
      rows: fileBatch,
      actorUserId: 'user-1',
      effectiveOptions: {},
      preparation: { vendor: null },
      batchOptions: {
        resumeAfterRowNo: 0,
        stopAfterBatch: true,
        hasMoreRowsAfterBatch: false,
        lookaheadRows: lookahead,
        leaseToken: worker.lease_token,
      },
    });

    const appliedRowNos = handler.applied.map((row) => row.row_no);
    expect(appliedRowNos).toContain(IMPORT_APPLY_BATCH_SIZE);
    expect(appliedRowNos).toContain(IMPORT_APPLY_BATCH_SIZE + 1);
    expect(appliedRowNos.indexOf(IMPORT_APPLY_BATCH_SIZE + 1)).toBeLessThan(
      appliedRowNos.indexOf(IMPORT_APPLY_BATCH_SIZE),
    );
    expect(new Set(appliedRowNos).size).toBe(appliedRowNos.length);
    expect(worker.last_committed_row_no).toBe(IMPORT_APPLY_BATCH_SIZE + 1);
  });

  it('continues past the first full page when more than fifty rows remain', async () => {
    const worker: ImportJobWorkerState = {
      phase: 'apply',
      lease_token: 'lease-party',
      lease_until: new Date(0).toISOString(),
      processed_rows: 0,
      last_committed_row_no: 0,
      started_at: new Date().toISOString(),
    };
    const { prisma } = createWorkerPrisma(worker);
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

    const totalRows = IMPORT_APPLY_BATCH_SIZE + 2;
    const fileBatch = Array.from({ length: IMPORT_APPLY_BATCH_SIZE }, (_, index) =>
      plannedRow(index + 1, ImportRowAction.SKIP),
    );
    fileBatch[IMPORT_APPLY_BATCH_SIZE - 1] = plannedRow(
      IMPORT_APPLY_BATCH_SIZE,
      ImportRowAction.CREATE,
    );
    const lookahead = [
      plannedRow(IMPORT_APPLY_BATCH_SIZE + 1, ImportRowAction.UPDATE),
    ];

    await handler.apply({
      tenantId: 'tenant-1',
      job: {
        id: 'job-1',
        source_system: 'legacy',
        options_json: { worker },
        totals_json: { rows: totalRows, create: 0, update: 0, skip: 0, error: 0 },
      },
      rows: fileBatch,
      actorUserId: 'user-1',
      effectiveOptions: {},
      preparation: { vendor: null },
      batchOptions: {
        resumeAfterRowNo: 0,
        stopAfterBatch: true,
        hasMoreRowsAfterBatch: true,
        lookaheadRows: lookahead,
        leaseToken: worker.lease_token,
      },
    });

    expect(handler.applied.map((row) => row.row_no)).toContain(
      IMPORT_APPLY_BATCH_SIZE,
    );
    expect(worker.last_committed_row_no).toBe(IMPORT_APPLY_BATCH_SIZE + 1);

    handler.applied.length = 0;
    await handler.apply({
      tenantId: 'tenant-1',
      job: {
        id: 'job-1',
        source_system: 'legacy',
        options_json: { worker },
        totals_json: { rows: totalRows, create: 0, update: 0, skip: 0, error: 0 },
      },
      rows: [plannedRow(IMPORT_APPLY_BATCH_SIZE + 2, ImportRowAction.CREATE)],
      actorUserId: 'user-1',
      effectiveOptions: {},
      preparation: { vendor: null },
      batchOptions: {
        resumeAfterRowNo: worker.last_committed_row_no,
        stopAfterBatch: true,
        hasMoreRowsAfterBatch: false,
        leaseToken: worker.lease_token,
      },
    });

    expect(handler.applied.map((row) => row.row_no)).toEqual([
      IMPORT_APPLY_BATCH_SIZE + 2,
    ]);
    expect(worker.last_committed_row_no).toBe(totalRows);
  });
});
