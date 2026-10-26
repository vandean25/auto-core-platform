import { Prisma } from '@prisma/client';
import { ImportJobStore } from './import-job.store.js';
import { commitApplyWorkerRowInTransaction } from './import-job.store.js';
import { ImportWorkerLeaseLostError } from './import-worker.errors.js';

describe('import worker contention', () => {
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

  it('commitApplyWorkerRowInTransaction never moves the cursor backwards', async () => {
    let worker = {
      lease_token: 'expected',
      last_committed_row_no: 50,
      processed_rows: 50,
    };
    const tx = {
      importJob: {
        findFirst: async () => ({
          status: 'APPLYING',
          options_json: { worker },
        }),
        update: async (args: {
          data: { options_json: { worker: typeof worker } };
        }) => {
          worker = args.data.options_json.worker;
        },
      },
    };
    await commitApplyWorkerRowInTransaction(
      tx as never,
      'tenant-1',
      'job-1',
      'expected',
      2,
    );
    expect(worker.last_committed_row_no).toBe(50);
    await commitApplyWorkerRowInTransaction(
      tx as never,
      'tenant-1',
      'job-1',
      'expected',
      51,
    );
    expect(worker.last_committed_row_no).toBe(51);
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
