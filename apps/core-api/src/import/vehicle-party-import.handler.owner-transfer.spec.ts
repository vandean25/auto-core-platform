import {
  ImportJobStatus,
  ImportRowAction,
  type Prisma,
} from '@prisma/client';
import type { ImportJobWorkerState } from './import-job.worker-state.js';
import type { SerializedImportJob } from './import-job.serializer.js';
import { RowByRowApplyRunner } from './import-row-apply.runner.js';
import type { ImportApplyInput, ImportApplyRow } from './import-type-handler.js';
import { VehiclePartyImportHandler } from './vehicle-party-import.handler.js';

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
  it('applies the closing update before the new owner create', async () => {
    const worker: ImportJobWorkerState = {
      phase: 'apply',
      lease_token: 'lease-party',
      lease_until: new Date(0).toISOString(),
      processed_rows: 0,
      last_committed_row_no: 49,
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

    const createRow = {
      row_no: 50,
      action: ImportRowAction.CREATE,
      entity_id: null,
      external_id: 'party-new',
      normalized_json: { vehicle_external_id: 'VEH-1' },
    };
    const updateRow = {
      row_no: 51,
      action: ImportRowAction.UPDATE,
      entity_id: 'party-old',
      external_id: 'party-old',
      normalized_json: { vehicle_external_id: 'VEH-1' },
    };

    await handler.apply({
      tenantId: 'tenant-1',
      job: {
        id: 'job-1',
        source_system: 'legacy',
        options_json: { worker },
        totals_json: { rows: 51, create: 0, update: 0, skip: 0, error: 0 },
      },
      rows: [createRow],
      actorUserId: 'user-1',
      effectiveOptions: {},
      preparation: { vendor: null },
      batchOptions: {
        resumeAfterRowNo: 49,
        stopAfterBatch: true,
        hasMoreRowsAfterBatch: false,
        lookaheadRows: [updateRow],
        leaseToken: worker.lease_token,
      },
    });

    expect(handler.applied.map((row) => row.row_no)).toEqual([51, 50]);
    expect(handler.applied[0]?.action).toBe(ImportRowAction.UPDATE);
    expect(handler.applied[1]?.action).toBe(ImportRowAction.CREATE);
    expect(worker.last_committed_row_no).toBe(51);
  });
});
