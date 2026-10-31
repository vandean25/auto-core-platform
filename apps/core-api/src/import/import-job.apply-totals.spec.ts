import { ImportJobStatus, ImportRowAction } from '@prisma/client';
import { ImportJobStore } from './import-job.store.js';

describe('ImportJobStore.lockForBackgroundApply', () => {
  it('resets apply action totals while keeping row count from dry-run', async () => {
    const testUpdatedAt = new Date();
    const findFirst = jest.fn(async () => ({
      status: ImportJobStatus.DRY_RUN_DONE,
      options_json: {},
      updatedAt: testUpdatedAt,
    }));
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const executeRaw = jest.fn(async () => 1);
    const prisma = {
      importJob: { updateMany, findFirst },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ importJob: { updateMany, findFirst }, $executeRaw: executeRaw }),
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

  it('clears technical error rows inside the lock transaction', async () => {
    const committed: { status: string; action: ImportRowAction } = {
      status: 'FAILED',
      action: ImportRowAction.ERROR,
    };
    const outerJobUpdate = jest.fn(async () => ({ count: 1 }));
    const outerRowUpdate = jest.fn(async () => ({ count: 1 }));
    const txJobUpdate = jest.fn(async (_args: unknown) => ({ count: 1 }));
    const txRowUpdate = jest.fn(async (_args: unknown) => ({ count: 1 }));
    const testUpdatedAt = new Date();
    const txFindFirst = jest.fn(async () => ({
      status: ImportJobStatus.FAILED,
      options_json: {},
      updatedAt: testUpdatedAt,
    }));
    const prisma = {
      importJob: { updateMany: outerJobUpdate, findFirst: async () => null },
      importJobRow: {
        findMany: async () => [
          { row_no: 2, entity_id: null, action: ImportRowAction.ERROR },
        ],
        updateMany: outerRowUpdate,
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const draft = { ...committed };
        const result = await fn({
          importJob: {
            findFirst: txFindFirst,
            updateMany: async (args: unknown) => {
              draft.status = 'APPLYING';
              return txJobUpdate(args);
            },
          },
          importJobRow: {
            findMany: async () => [
              { row_no: 2, entity_id: null, action: ImportRowAction.ERROR },
            ],
            updateMany: async (args: unknown) => {
              draft.action = ImportRowAction.CREATE;
              return txRowUpdate(args);
            },
          },
        });
        committed.status = draft.status;
        committed.action = draft.action;
        return result;
      },
    };
    const store = new ImportJobStore(prisma as never);
    await store.lockForApply('tenant-1', 'job-1', [], {
      technical_retry_row_nos: [2],
    });
    expect(txJobUpdate).toHaveBeenCalled();
    expect(txRowUpdate).toHaveBeenCalled();
    expect(outerJobUpdate).not.toHaveBeenCalled();
    expect(outerRowUpdate).not.toHaveBeenCalled();
    expect(committed).toEqual({
      status: 'APPLYING',
      action: ImportRowAction.CREATE,
    });

    committed.status = 'FAILED';
    committed.action = ImportRowAction.ERROR;
    txRowUpdate.mockRejectedValueOnce(new Error('row reset failed'));
    await expect(
      store.lockForApply('tenant-1', 'job-1', [], {
        technical_retry_row_nos: [2],
      }),
    ).rejects.toThrow('row reset failed');
    expect(committed).toEqual({
      status: 'FAILED',
      action: ImportRowAction.ERROR,
    });
  });

  it('rejects lock and matches updatedAt if job was updated concurrently', async () => {
    const jobUpdatedAt = new Date('2026-10-31T10:00:00.000Z');
    const findFirst = jest.fn(async () => ({
      status: ImportJobStatus.FAILED,
      options_json: { custom: 'preserved' },
      updatedAt: jobUpdatedAt,
    }));
    const updateMany = jest.fn(async () => ({ count: 0 }));
    const prisma = {
      importJob: { findFirst, updateMany },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ importJob: { findFirst, updateMany } }),
    };
    const store = new ImportJobStore(prisma as never);
    const result = await store.lockForApply('tenant-1', 'job-1');
    expect(result).toEqual({ count: 0 });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          updatedAt: jobUpdatedAt,
        }),
      }),
    );
  });
});
