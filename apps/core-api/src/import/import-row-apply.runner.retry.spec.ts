import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import type { SerializedImportJob } from './import-job.serializer.js';
import type { ImportJobWorkerState } from './import-job.worker-state.js';
import { ImportApplyRetryExhaustedError } from './import-apply.errors.js';
import { RowByRowApplyRunner } from './import-row-apply.runner.js';
import { VEHICLE_PARTY_RULE_CODES } from '../vehicle/vehicle-party.rules.js';
import { IMPORT_ROW_TX_MAX_ATTEMPTS } from './import.constants.js';
import { assignVehiclePartyApplySeqs } from './import-apply-sequence.test-util.js';
import { withApplyPersistedTotalsTransactionClient } from './import-apply-persisted-totals.test-util.js';

function p2034(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('write conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

function p2028(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Transaction API error', {
    code: 'P2028',
    clientVersion: 'test',
  });
}

function driverAdapterWriteConflict(): Error {
  const error = new Error('write conflict');
  error.name = 'DriverAdapterError';
  Object.assign(error, { cause: { kind: 'TransactionWriteConflict' } });
  return error;
}

/** The serializer only reports what the job state actually reached. */
function makeRunner(prisma: unknown) {
  return new RowByRowApplyRunner(
    prisma as never,
    { writeImportJobAudit: jest.fn() } as never,
    (job, totals) =>
      ({
        ...job,
        totals,
        status: job.status,
      }) as unknown as SerializedImportJob,
  );
}

function createWorker(leaseToken = 'lease-retry'): ImportJobWorkerState {
  return {
    phase: 'apply',
    lease_token: leaseToken,
    lease_until: new Date(0).toISOString(),
    processed_rows: 0,
    last_committed_apply_seq: 0,
    started_at: new Date().toISOString(),
  };
}

function vehiclePartyRow(rowNo: number, validFrom: string) {
  return {
    row_no: rowNo,
    action: ImportRowAction.CREATE,
    entity_id: null,
    external_id: `ext-${rowNo}`,
    normalized_json: {
      external_id: `ext-${rowNo}`,
      vehicle_id: 'veh-1',
      customer_id: 'cust-1',
      role: 'OWNER',
      valid_from: validFrom,
      valid_to: null,
      notes: null,
    },
  };
}

function createRow(rowNo = 1) {
  return {
    row_no: rowNo,
    action: ImportRowAction.CREATE,
    entity_id: null,
    external_id: `ext-${rowNo}`,
    normalized_json: { external_id: `ext-${rowNo}` },
  };
}

function emptyTotals(rows: number) {
  return { rows, create: 0, update: 0, skip: 0, error: 0 };
}

function syncPrisma(writeRowImpl: (tx: unknown, row: unknown) => Promise<void>) {
  const rowUpdates: Array<Record<string, unknown>> = [];
  const jobUpdates: unknown[] = [];
  let jobStatus: ImportJobStatus = ImportJobStatus.APPLYING;
  const actionCounts = new Map<ImportRowAction, number>();
  const importJobRow = {
    findFirst: async () => null,
    update: jest.fn(async (args: { data: { action?: ImportRowAction } }) => {
      rowUpdates.push(args.data);
      if (args.data.action) {
        actionCounts.set(
          args.data.action,
          (actionCounts.get(args.data.action) ?? 0) + 1,
        );
      }
    }),
    groupBy: jest.fn(async () => {
      if (actionCounts.size === 0) {
        return [{ action: ImportRowAction.CREATE, _count: { _all: 1 } }];
      }
      return [...actionCounts.entries()].map(([action, count]) => ({
        action,
        _count: { _all: count },
      }));
    }),
  };
  const importJob = {
    updateMany: jest.fn(
      async (args: { data: { status?: ImportJobStatus } }) => {
        jobUpdates.push(args);
        if (args.data.status) {
          jobStatus = args.data.status;
        }
      },
    ),
    findFirst: jest.fn(async () => ({
      id: 'job-sync',
      tenant_id: 'tenant-1',
      status: jobStatus,
      options_json: {},
      totals_json: emptyTotals(1),
      attempts_without_progress: 0,
    })),
    update: jest.fn(
      async (args: {
        data: {
          status?: ImportJobStatus;
          totals_json?: ReturnType<typeof emptyTotals>;
        };
      }) => {
        jobUpdates.push(args);
        if (args.data.status) {
          jobStatus = args.data.status;
        }
        return {
          id: 'job-sync',
          tenant_id: 'tenant-1',
          status: jobStatus,
          totals_json: args.data.totals_json ?? {
            rows: 1,
            create: 1,
            update: 0,
            skip: 0,
            error: 0,
          },
        };
      },
    ),
  };
  const tx = {
    externalIdMapping: { findFirst: async () => null },
    importJob,
    importJobRow,
  };
  return {
    prisma: {
      externalIdMapping: { findFirst: async () => null },
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>) =>
        fn(tx),
      importJob,
      importJobRow,
    },
    rowUpdates,
    jobUpdates,
    getJobStatus: () => jobStatus,
    writeRow: writeRowImpl,
  };
}

function syncInput(rows: ReturnType<typeof createRow>[]) {
  return {
    tenantId: 'tenant-1',
    job: {
      id: 'job-sync',
      source_system: 'legacy',
      options_json: {},
      totals_json: emptyTotals(1),
    },
    rows,
    actorUserId: 'user-1',
    effectiveOptions: {},
    preparation: { vendor: null },
  };
}

function sequencePrisma(worker: ImportJobWorkerState) {
  let jobStatus: ImportJobStatus = ImportJobStatus.APPLYING;
  const tx = withApplyPersistedTotalsTransactionClient(
    {
      importJob: {
        findFirst: async () => ({
          id: 'job-1',
          status: jobStatus,
          options_json: { worker },
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
      importJobRow: { update: jest.fn() },
      vehicleParty: { findFirst: async () => ({ id: 'party' }) },
      externalIdMapping: { findFirst: async () => null },
    },
    { expectedRows: 1 },
  );
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
        totals_json: emptyTotals(1),
      }),
      update: jest.fn(),
    },
    importJobRow: { update: jest.fn() },
  };
}

function sequenceInput(
  worker: ImportJobWorkerState,
  rows: unknown[],
  totalRows = 1,
) {
  return {
    tenantId: 'tenant-1',
    job: {
      id: 'job-1',
      source_system: 'legacy',
      options_json: { worker },
      totals_json: emptyTotals(totalRows),
    },
    rows,
    actorUserId: 'user-1',
    effectiveOptions: {},
    preparation: { vendor: null },
  };
}

function sequenceOptions(
  worker: ImportJobWorkerState,
  maxApplySeq = 1,
) {
  return {
    stopAfterBatch: true,
    useApplySequence: true,
    maxApplySeq,
    leaseToken: worker.lease_token,
  };
}

const noWrite = async () => undefined;

describe('RowByRowApplyRunner retries', () => {
  describe('sync path', () => {
    it('recovers from transient P2034 and marks the job APPLIED', async () => {
      let attempts = 0;
      const harness = syncPrisma(async () => {
        attempts += 1;
        if (attempts <= 2) {
          throw p2034();
        }
      });
      const runner = makeRunner(harness.prisma);

      const result = await runner.run(
        syncInput([createRow()]),
        ImportEntityType.CUSTOMER,
        harness.writeRow,
      );

      expect(result.status).toBe(ImportJobStatus.APPLIED);
      expect(attempts).toBe(3);
      expect(harness.rowUpdates).toHaveLength(0);
    });

    it('fails the job without marking the row ERROR when sync retries exhaust', async () => {
      const harness = syncPrisma(async () => {
        throw p2034();
      });
      const runner = makeRunner(harness.prisma);

      await expect(
        runner.run(
          syncInput([createRow()]),
          ImportEntityType.CUSTOMER,
          harness.writeRow,
        ),
      ).rejects.toBeInstanceOf(ImportApplyRetryExhaustedError);
      expect(harness.rowUpdates).toHaveLength(0);
      expect(harness.getJobStatus()).toBe(ImportJobStatus.FAILED);
      expect(harness.prisma.importJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            options_json: expect.objectContaining({
              apply_failure_reason: 'retry_exhausted',
            }),
          }),
        }),
      );
    }, 60_000);

    it('records a domain overlap on the row and still applies the job', async () => {
      const harness = syncPrisma(async () => {
        throw new ConflictException({
          code: VEHICLE_PARTY_RULE_CODES.OVERLAP,
          message: 'overlap',
        });
      });
      const runner = makeRunner(harness.prisma);

      const result = await runner.run(
        syncInput([createRow()]),
        ImportEntityType.VEHICLE_PARTY,
        harness.writeRow,
      );

      expect(result.totals.error).toBe(1);
      const rowUpdate = harness.prisma.importJobRow.update as jest.Mock;
      expect(rowUpdate.mock.calls[0][0].data.errors_json).toEqual([
        {
          code: VEHICLE_PARTY_RULE_CODES.OVERLAP,
          message: 'overlap',
        },
      ]);
      expect(result.status).toBe(ImportJobStatus.APPLIED);
    });

    it('retries transient P2034 on the APPLIED update', async () => {
      let appliedUpdateAttempts = 0;
      const harness = syncPrisma(noWrite);
      const appliedUpdate = harness.prisma.importJob.update as jest.Mock;
      appliedUpdate.mockImplementation(async () => {
        appliedUpdateAttempts += 1;
        if (appliedUpdateAttempts <= 2) {
          throw p2034();
        }
        return {
          id: 'job-sync',
          tenant_id: 'tenant-1',
          status: ImportJobStatus.APPLIED,
          totals_json: { rows: 1, create: 1, update: 0, skip: 0, error: 0 },
        };
      });
      const runner = makeRunner(harness.prisma);

      const result = await runner.run(
        syncInput([createRow()]),
        ImportEntityType.CUSTOMER,
        harness.writeRow,
      );

      expect(result.status).toBe(ImportJobStatus.APPLIED);
      expect(appliedUpdateAttempts).toBe(3);
    });

    it('re-applies after retry_exhausted without duplicating row writes', async () => {
      let appliedUpdateAttempts = 0;
      const harness = syncPrisma(noWrite);
      const appliedUpdate = harness.prisma.importJob.update as jest.Mock;
      appliedUpdate.mockImplementation(
        async (args: {
          data: {
            status?: ImportJobStatus;
            options_json?: Record<string, unknown>;
          };
        }) => {
          if (args.data.status === ImportJobStatus.APPLIED) {
            appliedUpdateAttempts += 1;
            if (appliedUpdateAttempts <= 8) {
              throw p2034();
            }
          }
          harness.jobUpdates.push(args);
          return {
            id: 'job-sync',
            status: args.data.status ?? ImportJobStatus.APPLYING,
            options_json: args.data.options_json ?? {},
          };
        },
      );
      const runner = makeRunner(harness.prisma);
      const row = createRow();
      let writeCount = 0;
      const writeRow = async () => {
        writeCount += 1;
      };

      await expect(
        runner.run(
          syncInput([row]),
          ImportEntityType.CUSTOMER,
          writeRow,
        ),
      ).rejects.toBeInstanceOf(ImportApplyRetryExhaustedError);
      expect(appliedUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ImportJobStatus.FAILED,
            options_json: expect.objectContaining({
              apply_failure_reason: 'retry_exhausted',
            }),
          }),
        }),
      );
      expect(writeCount).toBe(1);

      appliedUpdateAttempts = 8;
      const second = await runner.run(
        syncInput([row]),
        ImportEntityType.CUSTOMER,
        writeRow,
      );

      expect(second.status).toBe(ImportJobStatus.APPLIED);
      expect(second.totals.create).toBe(1);
      expect(writeCount).toBe(2);
    }, 90_000);
  });

  describe('background sequence path', () => {
    const rows = () =>
      assignVehiclePartyApplySeqs([vehiclePartyRow(1, '2026-01-01')]);

    it('rethrows persistent P2034 without marking the job FAILED or the row ERROR', async () => {
      const worker = createWorker();
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
            status: ImportJobStatus.APPLYING,
            totals_json: emptyTotals(1),
          }),
          update: jest.fn(),
        },
        importJobRow: { update: rowUpdate },
      };
      const runner = makeRunner(prisma);

      await expect(
        runner.run(
          sequenceInput(worker, rows()),
          ImportEntityType.VEHICLE_PARTY,
          noWrite,
          sequenceOptions(worker),
        ),
      ).rejects.toMatchObject({ code: 'P2034' });
      expect(rowUpdate).not.toHaveBeenCalled();
      expect(updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ImportJobStatus.FAILED }),
        }),
      );
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
            totals_json: emptyTotals(1),
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
        importJobRow: {
          findMany: async () => [],
          update: jest.fn(),
        },
        externalIdMapping: { findFirst: async () => null },
      };
      const prisma = {
        externalIdMapping: { findFirst: async () => null },
        $transaction: async (
          fn: (client: typeof tx) => Promise<unknown>,
        ) => fn(tx),
        importJob: {
          updateMany,
          findFirst: async () => {
            throw p2034();
          },
          update: jest.fn(),
        },
        importJobRow: { update: jest.fn(), findMany: async () => [] },
      };
      const runner = makeRunner(prisma);

      await expect(
        runner.run(
          sequenceInput(worker, rows()),
          ImportEntityType.VEHICLE_PARTY,
          noWrite,
          sequenceOptions(worker),
        ),
      ).rejects.toMatchObject({ code: 'P2034' });
      expect(updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ImportJobStatus.FAILED }),
        }),
      );
    });

    it('retries a driver write conflict and then succeeds', async () => {
      const worker = createWorker();
      const prisma = sequencePrisma(worker);
      let txAttempts = 0;
      const originalTransaction = prisma.$transaction.bind(prisma);
      prisma.$transaction = async (fn, options) => {
        txAttempts += 1;
        if (txAttempts === 1) {
          throw driverAdapterWriteConflict();
        }
        return originalTransaction(fn, options);
      };
      const rowUpdate = jest.fn();
      prisma.importJobRow.update = rowUpdate;
      const runner = makeRunner(prisma);

      await runner.run(
        sequenceInput(worker, rows()),
        ImportEntityType.VEHICLE_PARTY,
        noWrite,
        sequenceOptions(worker),
      );

      expect(txAttempts).toBeGreaterThan(1);
      expect(rowUpdate).not.toHaveBeenCalled();
      expect(worker.last_committed_apply_seq).toBe(1);
    });

    it('rethrows P2028 without marking the row ERROR', async () => {
      const worker = createWorker();
      const prisma = sequencePrisma(worker);
      prisma.$transaction = async () => {
        throw p2028();
      };
      const rowUpdate = jest.fn();
      prisma.importJobRow.update = rowUpdate;
      const runner = makeRunner(prisma);

      await expect(
        runner.run(
          sequenceInput(worker, rows()),
          ImportEntityType.VEHICLE_PARTY,
          noWrite,
          sequenceOptions(worker),
        ),
      ).rejects.toMatchObject({ code: 'P2028' });
      expect(rowUpdate).not.toHaveBeenCalled();
      expect(worker.last_committed_apply_seq).toBe(0);
    });

    it('completes one job when two workers race on the same rows', async () => {
      const workerA = createWorker('lease-a');
      const workerB = createWorker('lease-b');
      const appliedRowNos: number[] = [];
      const conflictOnce = { seen: false };

      const sharedPrisma = sequencePrisma(workerA);
      const originalTransaction = sharedPrisma.$transaction.bind(sharedPrisma);
      sharedPrisma.$transaction = async (fn, options) => {
        if (!conflictOnce.seen) {
          conflictOnce.seen = true;
          throw driverAdapterWriteConflict();
        }
        return originalTransaction(fn, options);
      };
      const runner = makeRunner(sharedPrisma);
      const rows = assignVehiclePartyApplySeqs([
        vehiclePartyRow(1, '2026-01-01'),
        vehiclePartyRow(2, '2026-01-02'),
      ]);

      const applyWithWorker = (worker: ImportJobWorkerState) =>
        runner.run(
          sequenceInput(worker, rows, 2),
          ImportEntityType.VEHICLE_PARTY,
          async (_tx, row) => {
            appliedRowNos.push(row.row_no);
          },
          sequenceOptions(worker, 2),
        );

      const results = await Promise.allSettled([
        applyWithWorker(workerA),
        applyWithWorker(workerB),
      ]);
      const fulfilled = results.filter(
        (result) => result.status === 'fulfilled',
      );

      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      expect(new Set(appliedRowNos).size).toBe(appliedRowNos.length);
      expect(appliedRowNos.sort()).toEqual([1, 2]);
    });
  });
});
