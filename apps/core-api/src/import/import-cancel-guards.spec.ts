import { ImportJobStatus } from '@prisma/client';
import { ImportJobStore } from './import-job.store.js';

describe('ImportJobStore cancel and worker guards', () => {
  it('cancels only a background dry-run job', async () => {
    const updateMany = jest
      .fn()
      .mockResolvedValue({ count: 1 });
    const prisma = {
      importJob: {
        findFirst: async () => ({
          status: ImportJobStatus.APPLYING,
          options_json: {
            worker: {
              phase: 'dry_run',
              lease_token: 't',
              lease_until: new Date(0).toISOString(),
              processed_rows: 0,
              started_at: new Date().toISOString(),
            },
          },
        }),
        updateMany,
      },
    };
    const store = new ImportJobStore(prisma as never);
    const result = await store.cancelBackgroundDryRun('tenant-1', 'job-1');
    expect(result.count).toBe(1);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: ImportJobStatus.APPLYING }),
        data: { status: ImportJobStatus.CANCELLED },
      }),
    );
  });

  it('does not append dry-run rows after cancel', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const update = jest.fn();
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          importJob: {
            updateMany,
            update,
          },
        }),
      importJob: {
        updateMany,
        update,
      },
    };
    const store = new ImportJobStore(prisma as never);
    const appended = await store.appendDryRunRows(
      'tenant-1',
      'job-1',
      [],
      { rows: 0, create: 0, update: 0, skip: 0, error: 0 },
      { processed_rows: 0 },
      {
        worker: {
          phase: 'dry_run',
          lease_token: 't',
          lease_until: new Date(0).toISOString(),
          processed_rows: 0,
          started_at: new Date().toISOString(),
        },
      },
      't',
    );
    expect(appended).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
});
