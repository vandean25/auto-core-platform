import { ImportJobStatus } from '@prisma/client';
import { ImportJobStore } from './import-job.store.js';

describe('ImportJobStore.lockForBackgroundApply', () => {
  it('resets apply action totals while keeping row count from dry-run', async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const prisma = {
      importJob: { updateMany },
    };
    const store = new ImportJobStore(prisma as never);
    await store.lockForBackgroundApply(
      'tenant-1',
      'job-1',
      { worker: undefined } as never,
      { rows: 250_000, create: 250_000, update: 0, skip: 0, error: 0 },
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
  });
});
