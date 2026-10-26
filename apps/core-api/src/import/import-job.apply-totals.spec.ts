import { ImportJobStatus } from '@prisma/client';
import { ImportJobStore } from './import-job.store.js';

describe('ImportJobStore.lockForBackgroundApply', () => {
  it('resets apply action totals while keeping row count from dry-run', async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const executeRaw = jest.fn(async () => 1);
    const prisma = {
      importJob: { updateMany },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ importJob: { updateMany }, $executeRaw: executeRaw }),
    };
    const store = new ImportJobStore(prisma as never);
    await store.lockForBackgroundApply(
      'tenant-1',
      'job-1',
      {},
      { rows: 250_000, create: 250_000, update: 0, skip: 0, error: 0 },
      'row_no',
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totals_json: {
            rows: 250_000,
            create: 0,
            update: 0,
            skip: 0,
            error: 0,
          },
          status: ImportJobStatus.APPLYING,
        }),
      }),
    );
    expect(executeRaw).toHaveBeenCalled();
  });
});
