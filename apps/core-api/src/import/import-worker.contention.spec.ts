import { Prisma } from '@prisma/client';
import { ImportJobStore } from './import-job.store.js';
import { commitApplyWorkerRowInTransaction } from './import-job.store.js';
import { ImportWorkerLeaseLostError } from './import-worker.errors.js';

describe('import worker contention', () => {
  it('claimWorkerLease returns null on driver adapter write conflict', async () => {
    const conflict = new Error('write conflict');
    conflict.name = 'DriverAdapterError';
    Object.assign(conflict, { cause: { kind: 'TransactionWriteConflict' } });
    const prisma = {
      $transaction: async () => {
        throw conflict;
      },
    };
    const store = new ImportJobStore(prisma as never);
    await expect(
      store.claimWorkerLease('tenant-1', 'job-1', 'dry_run'),
    ).resolves.toBeNull();
  });

  it('claimWorkerLease returns null on serialization failure', async () => {
    const prisma = {
      $transaction: async () => {
        throw new Prisma.PrismaClientKnownRequestError('serialization', {
          code: 'P2034',
          clientVersion: 'test',
        });
      },
    };
    const store = new ImportJobStore(prisma as never);
    await expect(
      store.claimWorkerLease('tenant-1', 'job-1', 'dry_run'),
    ).resolves.toBeNull();
  });

  it('commitApplyWorkerRowInTransaction throws when the lease token no longer matches', async () => {
    const tx = {
      importJob: {
        findFirst: async () => ({
          options_json: { worker: { lease_token: 'other' } },
        }),
      },
    };
    await expect(
      commitApplyWorkerRowInTransaction(
        tx as never,
        'tenant-1',
        'job-1',
        'expected',
        1,
      ),
    ).rejects.toBeInstanceOf(ImportWorkerLeaseLostError);
  });
});
