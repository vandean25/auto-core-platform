import { ImportJobStatus, ImportRowAction, Prisma } from '@prisma/client';
import type { SerializedImportJob } from './import-job.serializer.js';
import { SupplierChunkedApplyRunner } from './supplier-price-list-apply.runner.js';

function p2034(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('write conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

describe('SupplierChunkedApplyRunner retryable finish errors', () => {
  const vendor = { id: 'vendor-1', name: 'Vendor' };
  const baseInput = {
    tenantId: 'tenant-1',
    job: {
      id: 'job-supplier',
      source_system: 'legacy',
      options_json: {},
      totals_json: { rows: 1, create: 0, update: 0, skip: 0, error: 0 },
    },
    rows: [
      {
        row_no: 1,
        action: ImportRowAction.SKIP,
        entity_id: null,
        external_id: 'ext-1',
        normalized_json: {},
      },
    ],
    actorUserId: 'user-1',
    effectiveOptions: { vendor_id: 'vendor-1' },
    preparation: { vendor },
  };

  it('rethrows background P2034 on finish without marking the job FAILED', async () => {
    const worker = {
      phase: 'apply' as const,
      lease_token: 'lease-1',
      lease_until: new Date(0).toISOString(),
      processed_rows: 0,
      last_committed_apply_seq: 0,
      started_at: new Date().toISOString(),
    };
    let jobStatus: ImportJobStatus = ImportJobStatus.APPLYING;
    const updateMany = jest.fn(async (args: { data: { status?: ImportJobStatus } }) => {
      if (args.data.status === ImportJobStatus.FAILED) {
        jobStatus = ImportJobStatus.FAILED;
      }
      return { count: 1 };
    });
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          importJob: {
            update: async () => ({ id: 'job-supplier', status: jobStatus }),
            findFirst: async () => ({
              id: 'job-supplier',
              tenant_id: 'tenant-1',
              status: jobStatus,
              options_json: { worker },
            }),
          },
        };
        return fn(tx);
      },
      importJob: {
        updateMany,
        findFirst: async () => {
          throw p2034();
        },
        update: jest.fn(),
      },
      importJobRow: { update: jest.fn() },
    };
    const runner = new SupplierChunkedApplyRunner(
      prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, totals) =>
        ({ ...job, totals, status: job.status }) as unknown as SerializedImportJob,
    );
    await expect(
      runner.run(
        {
          ...baseInput,
          job: { ...baseInput.job, options_json: { worker } },
          batchOptions: {
            stopAfterBatch: true,
            leaseToken: 'lease-1',
            resumeAfterApplySeq: 0,
            hasMoreRowsAfterBatch: false,
          },
        },
        vendor,
      ),
    ).rejects.toMatchObject({ code: 'P2034' });
    expect(jobStatus).toBe(ImportJobStatus.APPLYING);
    expect(updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: ImportJobStatus.FAILED }),
      }),
    );
  });

  it('retries sync P2034 on the APPLIED transition', async () => {
    let txCalls = 0;
    let finishAttempts = 0;
    let jobStatus: ImportJobStatus = ImportJobStatus.APPLYING;
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        txCalls += 1;
        if (txCalls === 1) {
          const tx = {
            importJob: { update: async () => ({}) },
          };
          return fn(tx);
        }
        finishAttempts += 1;
        if (finishAttempts <= 2) {
          throw p2034();
        }
        const tx = {
          importJob: {
            update: async () => {
              jobStatus = ImportJobStatus.APPLIED;
              return { id: 'job-supplier', status: jobStatus };
            },
          },
        };
        return fn(tx);
      },
      importJob: {
        updateMany: jest.fn(),
        findFirst: async () => ({ id: 'job-supplier', status: jobStatus }),
        update: jest.fn(),
      },
      importJobRow: { update: jest.fn() },
    };
    const runner = new SupplierChunkedApplyRunner(
      prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, totals) =>
        ({
          ...job,
          totals,
          status: ImportJobStatus.APPLIED,
        }) as unknown as SerializedImportJob,
    );
    const result = await runner.run(baseInput, vendor);
    expect(result.status).toBe(ImportJobStatus.APPLIED);
    expect(finishAttempts).toBe(3);
  });

});
