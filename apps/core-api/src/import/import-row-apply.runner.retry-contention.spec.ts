import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import { DriverAdapterError } from '@prisma/driver-adapter-utils';
import type { SerializedImportJob } from './import-job.serializer.js';
import type { ImportJobWorkerState } from './import-job.worker-state.js';
import { RowByRowApplyRunner } from './import-row-apply.runner.js';
import { assignVehiclePartyApplySeqs } from './import-apply-sequence.test-util.js';

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

function createSequencePrisma(worker: ImportJobWorkerState) {
  let jobStatus = ImportJobStatus.APPLYING;
  const tx = {
    importJob: {
      findFirst: async () => ({
        id: 'job-1',
        status: jobStatus,
        options_json: { worker },
      }),
      update: async (args: {
        data: { status?: ImportJobStatus; options_json?: { worker: ImportJobWorkerState } };
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
    externalIdMapping: { findFirst: async () => null },
    $transaction: async (
      fn: (client: typeof tx) => Promise<unknown>,
      _options?: unknown,
    ) => fn(tx),
    importJob: {
      updateMany: jest.fn(),
      findFirst: async () => ({
        id: 'job-1',
        status: jobStatus,
        totals_json: { rows: 1, create: 0, update: 0, skip: 0, error: 0 },
      }),
      update: jest.fn(),
    },
    importJobRow: { update: jest.fn() },
  };
}

describe('RowByRowApplyRunner transaction retries', () => {
  it('retries a write conflict and then succeeds', async () => {
    const worker = createWorker();
    const prisma = createSequencePrisma(worker);
    let txAttempts = 0;
    const originalTransaction = prisma.$transaction.bind(prisma);
    prisma.$transaction = async (fn, options) => {
      txAttempts += 1;
      if (txAttempts === 1) {
        throw new DriverAdapterError({ kind: 'TransactionWriteConflict' });
      }
      return originalTransaction(fn, options);
    };
    const rowUpdate = jest.fn();
    prisma.importJobRow.update = rowUpdate;
    const runner = new RowByRowApplyRunner(
      prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, totals) =>
        ({ ...job, totals, status: job.status }) as unknown as SerializedImportJob,
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
    await runner.run(
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
    );
    expect(txAttempts).toBeGreaterThan(1);
    expect(rowUpdate).not.toHaveBeenCalled();
    expect(worker.last_committed_apply_seq).toBe(1);
  });

  it('rethrows P2028 without marking the row ERROR', async () => {
    const worker = createWorker();
    const prisma = createSequencePrisma(worker);
    prisma.$transaction = async () => {
      throw new Prisma.PrismaClientKnownRequestError('Transaction API error', {
        code: 'P2028',
        clientVersion: 'test',
      });
    };
    const rowUpdate = jest.fn();
    prisma.importJobRow.update = rowUpdate;
    const runner = new RowByRowApplyRunner(
      prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, totals) =>
        ({ ...job, totals, status: job.status }) as unknown as SerializedImportJob,
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
    ).rejects.toMatchObject({ code: 'P2028' });
    expect(rowUpdate).not.toHaveBeenCalled();
    expect(worker.last_committed_apply_seq).toBe(0);
  });

  it('completes one job when two workers race on the same rows', async () => {
    const workerA = createWorker();
    workerA.lease_token = 'lease-a';
    const workerB = { ...createWorker(), lease_token: 'lease-b' };
    const appliedRowNos: number[] = [];
    const conflictOnce = { seen: false };

    const sharedPrisma = createSequencePrisma(workerA);
    const originalTransaction = sharedPrisma.$transaction.bind(sharedPrisma);
    sharedPrisma.$transaction = async (fn, options) => {
      if (!conflictOnce.seen) {
        conflictOnce.seen = true;
        throw new DriverAdapterError({ kind: 'TransactionWriteConflict' });
      }
      return originalTransaction(fn, options);
    };

    const runner = new RowByRowApplyRunner(
      sharedPrisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, totals) =>
        ({ ...job, totals, status: job.status }) as unknown as SerializedImportJob,
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
      {
        row_no: 2,
        action: ImportRowAction.CREATE,
        entity_id: null,
        external_id: 'ext-2',
        normalized_json: {
          external_id: 'ext-2',
          vehicle_id: 'veh-1',
          customer_id: 'cust-1',
          role: 'OWNER',
          valid_from: '2026-01-02',
          valid_to: null,
          notes: null,
        },
      },
    ]);

    const applyWithWorker = async (worker: ImportJobWorkerState) =>
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
        async (_tx, row) => {
          appliedRowNos.push(row.row_no);
        },
        {
          stopAfterBatch: true,
          useApplySequence: true,
          maxApplySeq: 2,
          leaseToken: worker.lease_token,
        },
      );

    const results = await Promise.allSettled([
      applyWithWorker(workerA),
      applyWithWorker(workerB),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(new Set(appliedRowNos).size).toBe(appliedRowNos.length);
    expect(appliedRowNos.sort()).toEqual([1, 2]);
  });
});
