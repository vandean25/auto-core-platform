import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import type { SerializedImportJob } from './import-job.serializer.js';
import type { ImportJobWorkerState } from './import-job.worker-state.js';
import { RowByRowApplyRunner } from './import-row-apply.runner.js';
import { assignVehiclePartyApplySeqs } from './import-apply-sequence.test-util.js';
import { IMPORT_ROW_TX_MAX_ATTEMPTS } from './import.constants.js';

function p2034(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('write conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

function createWorker(): ImportJobWorkerState {
  return {
    phase: 'apply',
    lease_token: 'lease-retry',
    lease_until: new Date(0).toISOString(),
    processed_rows: 0,
    last_committed_apply_seq: 0,
    started_at: new Date().toISOString(),
  };
}

describe('RowByRowApplyRunner background retryable errors', () => {
  it('rethrows persistent P2034 without marking the job FAILED or the row ERROR', async () => {
    const worker = createWorker();
    const jobStatus = ImportJobStatus.APPLYING;
    const rowUpdate = jest.fn();
    const updateMany = jest.fn();
    const transaction = jest.fn(async () => {
      throw p2034();
    });
    const prisma = {
      externalIdMapping: { findFirst: async () => null },
      $transaction: transaction,
      importJob: {
        updateMany,
        findFirst: async () => ({
          id: 'job-1',
          status: 'APPLYING' as const,
          totals_json: { rows: 1, create: 0, update: 0, skip: 0, error: 0 },
        }),
        update: jest.fn(),
      },
      importJobRow: { update: rowUpdate },
    };
    const runner = new RowByRowApplyRunner(
      prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, rowTotals) =>
        ({
          ...job,
          totals: rowTotals,
          status: job.status,
        }) as unknown as SerializedImportJob,
    );
    const rows = assignVehiclePartyApplySeqs([
      {
        row_no: 1,
        action: ImportRowAction.CREATE,
        entity_id: null,
        external_id: 'ext-1',
        normalized_json: {
          external_id: 'ext-1',
          vehicle_id: 'veh-1',
          customer_id: 'cust-1',
          role: 'OWNER',
          valid_from: '2026-01-01',
          valid_to: null,
          notes: null,
        },
      },
    ]);
    await expect(
      runner.run(
        {
          tenantId: 'tenant-1',
          job: {
            id: 'job-1',
            source_system: 'legacy',
            options_json: { worker },
            totals_json: { rows: 1, create: 0, update: 0, skip: 0, error: 0 },
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
          maxApplySeq: 1,
          leaseToken: worker.lease_token,
        },
      ),
    ).rejects.toMatchObject({ code: 'P2034' });
    expect(rowUpdate).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: ImportJobStatus.FAILED }),
      }),
    );
    expect(jobStatus).toBe(ImportJobStatus.APPLYING);
    expect(transaction).toHaveBeenCalledTimes(IMPORT_ROW_TX_MAX_ATTEMPTS);
  });

  it('rethrows P2034 from finish findFirst without marking the job FAILED', async () => {
    const worker = createWorker();
    let jobStatus: ImportJobStatus = ImportJobStatus.APPLYING;
    const updateMany = jest.fn();
    const tx = {
      importJob: {
        findFirst: async () => ({
          id: 'job-1',
          status: jobStatus,
          options_json: { worker },
          totals_json: { rows: 1, create: 0, update: 0, skip: 0, error: 0 },
        }),
        update: async (args: {
          data: { status?: ImportJobStatus; options_json?: { worker: typeof worker } };
        }) => {
          if (args.data.options_json?.worker) {
            Object.assign(worker, args.data.options_json.worker);
          }
          if (args.data.status === ImportJobStatus.APPLIED) {
            jobStatus = ImportJobStatus.APPLIED;
          }
        },
      },
      importJobRow: {
        findMany: async () => [],
        update: jest.fn(),
      },
      externalIdMapping: { findFirst: async () => null },
    };
    const prisma = {
      externalIdMapping: { findFirst: async () => null },
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
      importJob: {
        updateMany,
        findFirst: async () => {
          throw p2034();
        },
        update: jest.fn(),
      },
      importJobRow: { update: jest.fn(), findMany: async () => [] },
    };
    const runner = new RowByRowApplyRunner(
      prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, rowTotals) =>
        ({
          ...job,
          totals: rowTotals,
          status: job.status,
        }) as unknown as SerializedImportJob,
    );
    const rows = assignVehiclePartyApplySeqs([
      {
        row_no: 1,
        action: ImportRowAction.CREATE,
        entity_id: null,
        external_id: 'ext-1',
        normalized_json: {
          external_id: 'ext-1',
          vehicle_id: 'veh-1',
          customer_id: 'cust-1',
          role: 'OWNER',
          valid_from: '2026-01-01',
          valid_to: null,
          notes: null,
        },
      },
    ]);
    await expect(
      runner.run(
        {
          tenantId: 'tenant-1',
          job: {
            id: 'job-1',
            source_system: 'legacy',
            options_json: { worker },
            totals_json: { rows: 1, create: 0, update: 0, skip: 0, error: 0 },
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
          maxApplySeq: 1,
          leaseToken: worker.lease_token,
        },
      ),
    ).rejects.toMatchObject({ code: 'P2034' });
    expect(updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: ImportJobStatus.FAILED }),
      }),
    );
  });
});
