import { Prisma } from '@prisma/client';
import {
  allocatePurchaseOrderNumber,
  bumpPurchaseOrderSequencePastNumber,
  createPurchaseOrderWithAllocatedNumber,
  formatPurchaseOrderNumber,
  parsePurchaseOrderNumberSuffix,
  syncPurchaseOrderSequenceForYear,
} from './purchase-order-number.util.js';

describe('purchase order number helpers', () => {
  it('parses PO-YYYY-NNNN suffixes', () => {
    expect(parsePurchaseOrderNumberSuffix('PO-2026-0042')).toEqual({
      year: 2026,
      suffix: 42,
    });
    expect(parsePurchaseOrderNumberSuffix('PO-26-0042')).toBeNull();
  });

  it('formats PO-YYYY-NNNN from the tenant/year sequence counter', async () => {
    const upsert = jest.fn().mockResolvedValue({ current: 42 });
    const tx = {
      site: { findMany: jest.fn().mockResolvedValue([{ id: 'site-1' }]) },
      purchaseOrder: { findMany: jest.fn().mockResolvedValue([]) },
      purchaseOrderSequence: { upsert, findFirst: jest.fn() },
    };

    const number = await allocatePurchaseOrderNumber(
      tx as never,
      'tenant-1',
      new Date('2026-06-01T12:00:00.000Z'),
    );

    expect(number).toBe('PO-2026-0042');
    expect(upsert).toHaveBeenCalled();
  });

  it('syncs the sequence to the max existing PO suffix for the year', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const tx = {
      site: { findMany: jest.fn().mockResolvedValue([{ id: 'site-1' }]) },
      purchaseOrder: {
        findMany: jest.fn().mockResolvedValue([
          { order_number: 'PO-2026-0001' },
          { order_number: 'PO-2026-7834' },
          { order_number: 'PO-2025-9999' },
        ]),
      },
      purchaseOrderSequence: {
        upsert,
        findFirst: jest.fn().mockResolvedValue({ current: 0 }),
      },
    };

    await syncPurchaseOrderSequenceForYear(tx as never, 'tenant-1', 2026);

    expect(upsert).toHaveBeenCalledWith({
      where: { tenant_id_year: { tenant_id: 'tenant-1', year: 2026 } },
      update: { current: 7834 },
      create: { tenant_id: 'tenant-1', year: 2026, current: 7834 },
    });
  });

  it('creates with numbers above seeded legacy suffixes and skips a collision', async () => {
    const used = new Set<string>();
    let current = 7834;
    const purchaseOrder = {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { order_number: 'PO-2026-0001' },
          { order_number: 'PO-2026-7834' },
        ]),
      create: jest.fn(({ data }: { data: { order_number: string } }) => {
        if (used.has(data.order_number)) {
          throw new Prisma.PrismaClientKnownRequestError('Unique', {
            code: 'P2002',
            clientVersion: 'test',
            meta: { target: ['tenant_id', 'order_number'] },
          });
        }
        used.add(data.order_number);
        return Promise.resolve({ id: 'po-1', order_number: data.order_number });
      }),
    };
    const purchaseOrderSequence = {
      findFirst: jest.fn().mockImplementation(async () => ({ current })),
      upsert: jest.fn().mockImplementation(async (args: { update?: { current?: number | { increment: number } }; create?: { current: number } }) => {
        if (args.update?.current && typeof args.update.current === 'object') {
          current += args.update.current.increment;
        } else if (typeof args.update?.current === 'number') {
          current = args.update.current;
        } else if (args.create) {
          current = args.create.current;
        }
        return { current };
      }),
    };
    const tx = {
      site: { findMany: jest.fn().mockResolvedValue([{ id: 'site-1' }]) },
      purchaseOrder,
      purchaseOrderSequence,
    };

    const first = await createPurchaseOrderWithAllocatedNumber(
      tx as never,
      'tenant-1',
      new Date('2026-01-01T00:00:00Z'),
      (orderNumber) =>
        tx.purchaseOrder.create({ data: { order_number: orderNumber } }),
    );
    used.add(formatPurchaseOrderNumber(2026, 7834));

    const second = await createPurchaseOrderWithAllocatedNumber(
      tx as never,
      'tenant-1',
      new Date('2026-01-01T00:00:00Z'),
      (orderNumber) =>
        tx.purchaseOrder.create({ data: { order_number: orderNumber } }),
    );

    expect(first.order_number).toBe('PO-2026-7835');
    expect(second.order_number).toBe('PO-2026-7836');
    expect(used.size).toBe(3);
  });

  it('bumps the sequence past a colliding order number', async () => {
    const upsert = jest.fn().mockResolvedValue({ current: 99 });
    const tx = {
      purchaseOrderSequence: {
        findFirst: jest.fn().mockResolvedValue({ current: 1 }),
        upsert,
      },
    };

    await bumpPurchaseOrderSequencePastNumber(
      tx as never,
      'tenant-1',
      'PO-2026-0099',
    );

    expect(upsert).toHaveBeenCalledWith({
      where: { tenant_id_year: { tenant_id: 'tenant-1', year: 2026 } },
      update: { current: 99 },
      create: { tenant_id: 'tenant-1', year: 2026, current: 99 },
    });
  });
});
