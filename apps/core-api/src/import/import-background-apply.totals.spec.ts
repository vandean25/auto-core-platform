import { ImportRowAction } from '@prisma/client';
import {
  isBackgroundApplyOutcomeComplete,
  reconcileFinishedApplyTotals,
} from './import-background-apply.totals.js';

describe('reconcileFinishedApplyTotals', () => {
  it('does not inflate create from external-id mappings', async () => {
    const totals = { rows: 1, create: 0, update: 1, skip: 0, error: 0 };
    const result = await reconcileFinishedApplyTotals(
      {
        importJobRow: {
          count: jest.fn(async () => 0),
        },
      } as never,
      { tenantId: 'tenant-1', jobId: 'job-1' },
      totals,
    );
    expect(result).toEqual(totals);
  });

  it('raises error total from committed ERROR rows', async () => {
    const totals = { rows: 2, create: 1, update: 0, skip: 0, error: 0 };
    const result = await reconcileFinishedApplyTotals(
      {
        importJobRow: {
          count: jest.fn(async () => 1),
        },
      } as never,
      { tenantId: 'tenant-1', jobId: 'job-1' },
      totals,
    );
    expect(result.error).toBe(1);
    expect(result.create).toBe(1);
  });
});

describe('isBackgroundApplyOutcomeComplete', () => {
  const db = (counts: {
    rows: number;
    creates: number;
    updates: number;
  }) => ({
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
  });

  it('accepts UPDATE adopt with a new mapping when create stays 0', async () => {
    const complete = await isBackgroundApplyOutcomeComplete(
      db({ rows: 1, creates: 0, updates: 1 }) as never,
      { tenantId: 'tenant-1', jobId: 'job-1' },
      { rows: 1, create: 0, update: 1, skip: 0, error: 0 },
    );
    expect(complete).toBe(true);
  });

  it('rejects finished apply when CREATE rows are not tallied', async () => {
    const complete = await isBackgroundApplyOutcomeComplete(
      db({ rows: 3, creates: 3, updates: 0 }) as never,
      { tenantId: 'tenant-1', jobId: 'job-1' },
      { rows: 3, create: 0, update: 0, skip: 0, error: 0 },
    );
    expect(complete).toBe(false);
  });

  it('accepts CREATE rows tallied via noop retries', async () => {
    const complete = await isBackgroundApplyOutcomeComplete(
      db({ rows: 3, creates: 3, updates: 0 }) as never,
      { tenantId: 'tenant-1', jobId: 'job-1' },
      { rows: 3, create: 3, update: 0, skip: 0, error: 0 },
    );
    expect(complete).toBe(true);
  });
});
