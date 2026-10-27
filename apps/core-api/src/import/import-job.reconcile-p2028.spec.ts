import { ImportJobStatus, ImportRowAction, Prisma } from '@prisma/client';
import { TenantContextStorage } from '../common/services/tenant-context.storage.js';
import { ImportJobStore } from './import-job.store.js';
import { ImportApplyRetryExhaustedError } from './import-apply.errors.js';
import type { ImportJobOptionsWithWorker } from './import-job.worker-state.js';

function p2028Error() {
  return new Prisma.PrismaClientKnownRequestError('transaction expired', {
    code: 'P2028',
    clientVersion: 'test',
  });
}

describe('persistDryRunReconcileChunk P2028', () => {
  it('retries once then fails the job with retry_exhausted', async () => {
    const job = {
      id: 'job-1',
      tenant_id: 'tenant-1',
      status: ImportJobStatus.APPLYING,
      totals_json: { rows: 2, create: 0, update: 0, skip: 0, error: 0 },
      options_json: {
        worker: {
          phase: 'dry_run',
          lease_token: 'lease-1',
          lease_until: new Date().toISOString(),
          processed_rows: 0,
          dry_run_reconcile_active: true,
          dry_run_reconcile_cursor: 0,
          started_at: new Date().toISOString(),
        },
      } satisfies ImportJobOptionsWithWorker,
    };
    let transactionAttempts = 0;
    let failureOptionsJson: Record<string, unknown> | undefined;
    const prisma = {
      $transaction: async (
        fn: (tx: unknown) => Promise<unknown>,
        _options?: unknown,
      ) => {
        transactionAttempts += 1;
        if (transactionAttempts <= 2) {
          throw p2028Error();
        }
        return fn({
          importJob: {
            updateMany: async (args: {
              data: { options_json: Record<string, unknown> };
            }) => {
              failureOptionsJson = args.data.options_json;
              return { count: 1 };
            },
            update: async () => job,
            findFirst: async () => job,
          },
          importJobRow: {
            updateMany: async () => ({ count: 1 }),
          },
        });
      },
      importJob: {
        findFirst: async () => job,
      },
    };
    const store = new ImportJobStore(prisma as never);
    await TenantContextStorage.run(async () => {
      TenantContextStorage.setUser({
        tenantId: 'tenant-1',
        userId: 'user-1',
        firebaseUid: 'fb-1',
      });
      await expect(
        store.persistDryRunReconcileChunk(
          'tenant-1',
          'job-1',
          [
            {
              row_no: 1,
              action: ImportRowAction.CREATE,
              external_id: 'a',
              entity_id: null,
              errors: [],
              warnings: [],
              normalized: null,
            },
          ],
          { dry_run_reconcile_cursor: 1 },
          job.options_json,
          'lease-1',
        ),
      ).rejects.toBeInstanceOf(ImportApplyRetryExhaustedError);
    });
    expect(transactionAttempts).toBe(3);
    expect(failureOptionsJson?.apply_failure_reason).toBe('retry_exhausted');
  });
});
