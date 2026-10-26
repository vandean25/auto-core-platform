import {
  ImportJobStatus,
  ImportRowAction,
  type Prisma,
} from '@prisma/client';
import { IMPORT_APPLY_BATCH_SIZE } from './import.constants.js';
import type { ImportJobWorkerState } from './import-job.worker-state.js';
import type { SerializedImportJob } from './import-job.serializer.js';
import { RowByRowApplyRunner } from './import-row-apply.runner.js';
import type { ImportApplyInput, ImportApplyRow } from './import-type-handler.js';
import {
  assignVehiclePartyApplySeqs,
  maxApplySeq,
  pageByApplySeq,
} from './import-apply-sequence.test-util.js';
import { VehiclePartyImportHandler } from './vehicle-party-import.handler.js';

function makeMixedPage(lastRowNo: number, updateRowNo: number) {
  return Array.from({ length: lastRowNo }, (_, index) => {
    const rowNo = index + 1;
    const isUpdate = rowNo === updateRowNo;
    return {
      row_no: rowNo,
      action: isUpdate ? ImportRowAction.UPDATE : ImportRowAction.CREATE,
      entity_id: isUpdate ? `party-${rowNo}` : null,
      external_id: `ext-${rowNo}`,
      normalized_json: { external_id: `ext-${rowNo}` },
    };
  });
}

function createWorkerPrisma(worker: ImportJobWorkerState) {
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
    vehicleParty: { findFirst: async () => ({ id: 'party' }) },
    externalIdMapping: { findFirst: async () => null },
    importJobRow: { update: jest.fn() },
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
  readonly appliedRowNos: number[] = [];

  protected override writeRow(
    _tx: Prisma.TransactionClient,
    row: ImportApplyRow,
    _input: ImportApplyInput,
  ): Promise<void> {
    this.appliedRowNos.push(row.row_no);
    return Promise.resolve();
  }
}

describe('VehiclePartyImportHandler background resume', () => {
  it('does not re-apply mixed create/update rows across batches', async () => {
    const worker: ImportJobWorkerState = {
      phase: 'apply',
      lease_token: 'lease-party',
      lease_until: new Date(0).toISOString(),
      processed_rows: 0,
      last_committed_apply_seq: 0,
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

    const totalRows = IMPORT_APPLY_BATCH_SIZE + 1;
    const updateRowNo = IMPORT_APPLY_BATCH_SIZE;
    const allRows = assignVehiclePartyApplySeqs(
      makeMixedPage(totalRows, updateRowNo),
    );
    const maxSeq = maxApplySeq(allRows);
    let totalsJson = {
      rows: totalRows,
      create: 0,
      update: 0,
      skip: 0,
      error: 0,
    };

    while ((worker.last_committed_apply_seq ?? 0) < maxSeq) {
      const resumeAfter = worker.last_committed_apply_seq ?? 0;
      const peek = pageByApplySeq(allRows, resumeAfter, IMPORT_APPLY_BATCH_SIZE + 1);
      const page = peek.slice(0, IMPORT_APPLY_BATCH_SIZE);
      const result = await handler.apply({
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
          hasMoreRowsAfterBatch: peek.length > IMPORT_APPLY_BATCH_SIZE,
          useApplySequence: true,
          maxApplySeq: maxSeq,
          leaseToken: worker.lease_token,
        },
      });
      totalsJson = result.totals;
    }

    const counts = new Map<number, number>();
    for (const rowNo of handler.appliedRowNos) {
      counts.set(rowNo, (counts.get(rowNo) ?? 0) + 1);
    }
    for (const count of counts.values()) {
      expect(count).toBe(1);
    }
    expect(handler.appliedRowNos).toHaveLength(totalRows);
    expect(handler.appliedRowNos).toContain(updateRowNo);
  });
});
