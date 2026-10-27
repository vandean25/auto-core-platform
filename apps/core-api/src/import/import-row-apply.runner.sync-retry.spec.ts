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
  const tx = {
    externalIdMapping: { findFirst: async () => null },
    importJobRow: { findFirst: async () => null },
  };
  return {
    prisma: {
      externalIdMapping: { findFirst: async () => null },
      $transaction: async (fn: (client: typeof tx) => Promise<void>) => {
        await fn(tx);
      },
      importJob: {
        updateMany: jest.fn(async (args: { data: { status?: ImportJobStatus } }) => {
          jobUpdates.push(args);
          if (args.data.status) {
            jobStatus = args.data.status;
          }
        }),
        findFirst: jest.fn(async () => ({
          id: 'job-sync',
          status: jobStatus,
          options_json: {},
        })),
        update: jest.fn(async (args: { data: { status?: ImportJobStatus } }) => {
          jobUpdates.push(args);
          if (args.data.status) {
            jobStatus = args.data.status;
          }
        }),
      },
      importJobRow: {
        update: jest.fn(async (args: { data: unknown }) => {
          rowUpdates.push(args.data as Record<string, unknown>);
        }),
      },
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

  it(
    'fails the job without marking the row ERROR when sync retries exhaust',
    async () => {
    const harness = createSyncPrisma(async () => {
      throw p2034();
    });
    const runner = new RowByRowApplyRunner(
      harness.prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, totals) =>
        ({ ...job, totals, status: job.status }) as unknown as SerializedImportJob,
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
    },
    60_000,
  );

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

});
