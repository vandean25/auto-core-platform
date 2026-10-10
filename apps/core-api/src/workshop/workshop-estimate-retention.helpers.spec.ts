import type { Prisma } from '@prisma/client';
import {
  endOfDecemberRetention,
  extendEstimateRetentionForInvoicedOrder,
  retainUntilAtSend,
} from './workshop-estimate-retention.helpers.js';

describe('workshop estimate retention', () => {
  it('keeps a never-converted estimate to 31 December of the document year plus three', () => {
    expect(retainUntilAtSend(new Date('2026-06-01T10:00:00.000Z'))).toEqual(
      new Date('2029-12-31T23:59:59.999+01:00'),
    );
  });

  it('uses the Vienna calendar year for the document year at the year boundary', () => {
    // 2026-12-31 23:30 UTC is already 2027-01-01 00:30 in Vienna.
    expect(retainUntilAtSend(new Date('2026-12-31T23:30:00.000Z'))).toEqual(
      new Date('2030-12-31T23:59:59.999+01:00'),
    );
  });

  it('builds the end-of-December cut-off in Vienna time', () => {
    expect(endOfDecemberRetention(2026, 7).toISOString()).toBe(
      '2033-12-31T22:59:59.999Z',
    );
  });

  it('extends sent versions of an invoiced order to year plus seven and never shortens them', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const tx = {
      workshopEstimate: {
        findFirst: jest.fn().mockResolvedValue({ id: 'estimate-1' }),
      },
      workshopEstimateVersion: {
        findMany: jest.fn().mockResolvedValue([
          { sent_at: new Date('2026-06-01T10:00:00.000Z') },
          { sent_at: new Date('2026-09-01T10:00:00.000Z') },
        ]),
        updateMany,
      },
    } as unknown as Prisma.TransactionClient;

    const changed = await extendEstimateRetentionForInvoicedOrder(
      tx,
      'tenant-1',
      'order-1',
    );

    expect(changed).toBe(2);
    expect(updateMany).toHaveBeenCalledTimes(1);
    const call = updateMany.mock.calls[0][0];
    expect(call.data).toEqual({ retain_until: endOfDecemberRetention(2026, 7) });
    expect(call.where.tenant_id).toBe('tenant-1');
    expect(call.where.estimate_id).toBe('estimate-1');
    expect(call.where.status).toEqual({ not: 'DRAFT' });
    expect(call.where.OR).toEqual([
      { retain_until: null },
      { retain_until: { lt: endOfDecemberRetention(2026, 7) } },
    ]);
  });

  it('does nothing when the order has no estimate', async () => {
    const updateMany = jest.fn();
    const tx = {
      workshopEstimate: { findFirst: jest.fn().mockResolvedValue(null) },
      workshopEstimateVersion: { findMany: jest.fn(), updateMany },
    } as unknown as Prisma.TransactionClient;

    await expect(
      extendEstimateRetentionForInvoicedOrder(tx, 'tenant-1', 'order-1'),
    ).resolves.toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
