import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import type { SerializedImportJob } from './import-job.serializer.js';
import {
  ImportApplyRetryExhaustedError,
  ImportRowDomainError,
} from './import-apply.errors.js';
import { RowByRowApplyRunner } from './import-row-apply.runner.js';
import { VEHICLE_PARTY_RULE_CODES } from '../vehicle/vehicle-party.rules.js';

function p2034(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('write conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

function createSyncPrisma(
  writeRowImpl: (tx: unknown, row: unknown) => Promise<void>,
) {
  const rowUpdates: Array<Record<string, unknown>> = [];
  const jobUpdates: unknown[] = [];
  let jobStatus: ImportJobStatus = ImportJobStatus.APPLYING;
  const actionCounts = new Map<ImportRowAction, number>();
  const importJobRow = {
    findFirst: async () => null,
    update: jest.fn(async (args: { data: { action?: ImportRowAction } }) => {
      rowUpdates.push(args.data as Record<string, unknown>);
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
      totals_json: { rows: 1, create: 0, update: 0, skip: 0, error: 0 },
      attempts_without_progress: 0,
    })),
    update: jest.fn(async (args: { data: { status?: ImportJobStatus } }) => {
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
    }),
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

describe('RowByRowApplyRunner sync retries', () => {
  const baseInput = {
    tenantId: 'tenant-1',
    job: {
      id: 'job-sync',
      source_system: 'legacy',
      options_json: {},
      totals_json: { rows: 1, create: 0, update: 0, skip: 0, error: 0 },
    },
    actorUserId: 'user-1',
    effectiveOptions: {},
    preparation: { vendor: null },
  };

  it('recovers from transient P2034 and marks the job APPLIED', async () => {
    let attempts = 0;
    const harness = createSyncPrisma(async () => {
      attempts += 1;
      if (attempts <= 2) {
        throw p2034();
      }
    });
    const runner = new RowByRowApplyRunner(
      harness.prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, totals) =>
        ({
          ...job,
          totals,
          status: ImportJobStatus.APPLIED,
        }) as unknown as SerializedImportJob,
    );
    const result = await runner.run(
      {
        ...baseInput,
        rows: [
          {
            row_no: 1,
            action: ImportRowAction.CREATE,
            entity_id: null,
            external_id: 'ext-1',
            normalized_json: { external_id: 'ext-1' },
          },
        ],
      },
      ImportEntityType.CUSTOMER,
      harness.writeRow,
    );
    expect(result.status).toBe(ImportJobStatus.APPLIED);
    expect(attempts).toBe(3);
    expect(harness.rowUpdates).toHaveLength(0);
  });

  it('fails the job without marking the row ERROR when sync retries exhaust', async () => {
    const harness = createSyncPrisma(async () => {
      throw p2034();
    });
    const runner = new RowByRowApplyRunner(
      harness.prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, totals) =>
        ({
          ...job,
          totals,
          status: job.status,
        }) as unknown as SerializedImportJob,
    );
    await expect(
      runner.run(
        {
          ...baseInput,
          rows: [
            {
              row_no: 1,
              action: ImportRowAction.CREATE,
              entity_id: null,
              external_id: 'ext-1',
              normalized_json: { external_id: 'ext-1' },
            },
          ],
        },
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
    const harness = createSyncPrisma(async () => {
      throw new ConflictException({
        code: VEHICLE_PARTY_RULE_CODES.OVERLAP,
        message: 'overlap',
      });
    });
    const runner = new RowByRowApplyRunner(
      harness.prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, totals) =>
        ({
          ...job,
          totals,
          status: ImportJobStatus.APPLIED,
        }) as unknown as SerializedImportJob,
    );
    const result = await runner.run(
      {
        ...baseInput,
        job: {
          ...baseInput.job,
          totals_json: { rows: 1, create: 0, update: 0, skip: 0, error: 0 },
        },
        rows: [
          {
            row_no: 1,
            action: ImportRowAction.CREATE,
            entity_id: null,
            external_id: 'ext-1',
            normalized_json: { external_id: 'ext-1' },
          },
        ],
      },
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
    const harness = createSyncPrisma(async () => undefined);
    const baseUpdate = harness.prisma.importJob.update as jest.Mock;
    baseUpdate.mockImplementation(
      async (args: { data: { status?: ImportJobStatus } }) => {
        if (args.data.status === ImportJobStatus.APPLIED) {
          appliedUpdateAttempts += 1;
          if (appliedUpdateAttempts <= 2) {
            throw p2034();
          }
        }
        harness.jobUpdates.push(args);
      },
    );
    const runner = new RowByRowApplyRunner(
      harness.prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, totals) =>
        ({
          ...job,
          totals,
          status: ImportJobStatus.APPLIED,
        }) as unknown as SerializedImportJob,
    );
    const result = await runner.run(
      {
        ...baseInput,
        rows: [
          {
            row_no: 1,
            action: ImportRowAction.CREATE,
            entity_id: null,
            external_id: 'ext-1',
            normalized_json: { external_id: 'ext-1' },
          },
        ],
      },
      ImportEntityType.CUSTOMER,
      harness.writeRow,
    );
    expect(result.status).toBe(ImportJobStatus.APPLIED);
    expect(appliedUpdateAttempts).toBe(3);
  });

  it('re-applies after retry_exhausted without duplicating row writes', async () => {
    let appliedUpdateAttempts = 0;
    const harness = createSyncPrisma(async () => undefined);
    const baseUpdate = harness.prisma.importJob.update as jest.Mock;
    baseUpdate.mockImplementation(
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
    const runner = new RowByRowApplyRunner(
      harness.prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, totals) =>
        ({
          ...job,
          totals,
          status: job.status,
        }) as unknown as SerializedImportJob,
    );
    const row = {
      row_no: 1,
      action: ImportRowAction.CREATE,
      entity_id: null,
      external_id: 'ext-1',
      normalized_json: { external_id: 'ext-1' },
    };
    let writeCount = 0;
    const writeRow = async () => {
      writeCount += 1;
    };
    await expect(
      runner.run(
        { ...baseInput, rows: [row] },
        ImportEntityType.CUSTOMER,
        writeRow,
      ),
    ).rejects.toBeInstanceOf(ImportApplyRetryExhaustedError);
    expect(baseUpdate).toHaveBeenCalledWith(
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
      { ...baseInput, rows: [row] },
      ImportEntityType.CUSTOMER,
      writeRow,
    );
    expect(second.status).toBe(ImportJobStatus.APPLIED);
    expect(second.totals.create).toBe(1);
    expect(writeCount).toBe(2);
  }, 90_000);
});
