import { ImportJobStatus, ImportRowAction, Prisma } from '@prisma/client';
import { ImportApplyRetryExhaustedError } from './import-apply.errors.js';
import { SupplierChunkedApplyRunner } from './supplier-price-list-apply.runner.js';
import { IMPORT_SYNC_ROW_TX_MAX_ATTEMPTS } from './import.constants.js';

function p2034(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('write conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

describe('SupplierChunkedApplyRunner sync row retries', () => {
  it('throws ImportApplyRetryExhaustedError after persistent row P2034', async () => {
    jest.useFakeTimers();
    const transaction = jest.fn(async () => {
      throw p2034();
    });
    const prisma = {
      $transaction: transaction,
      importJob: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        findFirst: async () => ({
          id: 'job-supplier',
          status: ImportJobStatus.APPLYING,
          options_json: {},
        }),
        update: jest.fn(),
      },
      importJobRow: { update: jest.fn() },
    };
    const runner = new SupplierChunkedApplyRunner(
      prisma as never,
      { writeImportJobAudit: jest.fn() } as never,
      (job, totals) => ({ ...job, totals, status: job.status }) as never,
    );
    const exhausted = expect(
      runner.run(
        {
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
          preparation: { vendor: { id: 'vendor-1', name: 'Vendor' } },
        },
        { id: 'vendor-1', name: 'Vendor' },
      ),
    ).rejects.toBeInstanceOf(ImportApplyRetryExhaustedError);
    await jest.runAllTimersAsync();
    await exhausted;
    jest.useRealTimers();
    expect(transaction.mock.calls.length).toBeGreaterThanOrEqual(
      IMPORT_SYNC_ROW_TX_MAX_ATTEMPTS,
    );
  }, 30_000);
});
