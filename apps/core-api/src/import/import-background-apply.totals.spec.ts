import { ImportRowAction } from '@prisma/client';
import { isBackgroundApplyOutcomeComplete } from './import-background-apply.totals.js';

describe('isBackgroundApplyOutcomeComplete', () => {
  const db = (counts: {
    rows: number;
    creates: number;
    updates: number;
  }) =>
    ({
      importJobRow: {
        count: jest.fn(async (args: { where: { action?: ImportRowAction } }) => {
          if (args.where.action === ImportRowAction.CREATE) {
            return counts.creates;
          }
          if (args.where.action === ImportRowAction.UPDATE) {
            return counts.updates;
          }
          return counts.rows;
        }),
      },
    }) as never;

  it('accepts UPDATE adopt with a new mapping when create stays 0', async () => {
    const complete = await isBackgroundApplyOutcomeComplete(
      db({ rows: 1, creates: 0, updates: 1 }),
      { tenantId: 'tenant-1', jobId: 'job-1' },
      { rows: 1, create: 0, update: 1, skip: 0, error: 0 },
    );
    expect(complete).toBe(true);
  });

  it('rejects finished apply when CREATE rows are not tallied', async () => {
    const complete = await isBackgroundApplyOutcomeComplete(
      db({ rows: 3, creates: 3, updates: 0 }),
      { tenantId: 'tenant-1', jobId: 'job-1' },
      { rows: 3, create: 0, update: 0, skip: 0, error: 0 },
    );
    expect(complete).toBe(false);
  });

  it('accepts CREATE rows tallied via noop retries', async () => {
    const complete = await isBackgroundApplyOutcomeComplete(
      db({ rows: 3, creates: 3, updates: 0 }),
      { tenantId: 'tenant-1', jobId: 'job-1' },
      { rows: 3, create: 3, update: 0, skip: 0, error: 0 },
    );
    expect(complete).toBe(true);
  });

  it('accepts mixed CREATE, UPDATE, and ERROR tallies across batches', async () => {
    const complete = await isBackgroundApplyOutcomeComplete(
      db({ rows: 5, creates: 2, updates: 1 }),
      { tenantId: 'tenant-1', jobId: 'job-1' },
      { rows: 5, create: 2, update: 1, skip: 0, error: 2 },
    );
    expect(complete).toBe(true);
  });
});
