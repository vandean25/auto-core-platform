import { Prisma } from '@prisma/client';
import {
  allocatePurchaseOrderNumber,
  bumpPurchaseOrderSequencePastNumber,
  createPurchaseOrderWithAllocatedNumber,
  ensurePurchaseOrderSequenceRowForYear,
  formatPurchaseOrderNumber,
  parsePurchaseOrderNumberSuffix,
} from './purchase-order-number.util.js';
import {
  passThroughPurchaseOrderCreateSavepoint,
  resetPurchaseOrderCreateSavepointPortForTests,
  setPurchaseOrderCreateSavepointPortForTests,
} from './purchase-order-create-savepoint.js';

describe('purchase order number helpers', () => {
  beforeAll(() => {
    setPurchaseOrderCreateSavepointPortForTests(
      passThroughPurchaseOrderCreateSavepoint,
    );
  });

  afterAll(() => {
    resetPurchaseOrderCreateSavepointPortForTests();
  });
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
      purchaseOrderSequence: {
        upsert,
        findFirst: jest.fn().mockResolvedValue({ id: 'seq-1' }),
      },
    };

    const number = await allocatePurchaseOrderNumber(
      tx as never,
      'tenant-1',
      new Date('2026-06-01T12:00:00.000Z'),
    );

    expect(number).toBe('PO-2026-0042');
    expect(upsert).toHaveBeenCalledWith({
      where: { tenant_id_year: { tenant_id: 'tenant-1', year: 2026 } },
      update: { current: { increment: 1 } },
      create: { tenant_id: 'tenant-1', year: 2026, current: 1 },
    });
  });

  it('seeds the sequence from the latest order suffix when the row is missing', async () => {
    const create = jest.fn().mockResolvedValue({});
    const tx = {
      purchaseOrder: {
        findFirst: jest.fn().mockResolvedValue({ order_number: 'PO-2026-7834' }),
      },
      purchaseOrderSequence: {
        findFirst: jest.fn().mockResolvedValue(null),
        create,
      },
    };

    await ensurePurchaseOrderSequenceRowForYear(tx as never, 'tenant-1', 2026);

    expect(create).toHaveBeenCalledWith({
      data: { tenant_id: 'tenant-1', year: 2026, current: 7834 },
    });
  });

  it('does not read purchase orders when the sequence row already exists', async () => {
    const findFirstOrder = jest.fn();
    const tx = {
      purchaseOrder: { findFirst: findFirstOrder },
      purchaseOrderSequence: {
        findFirst: jest.fn().mockResolvedValue({ id: 'seq-1' }),
      },
    };

    await ensurePurchaseOrderSequenceRowForYear(tx as never, 'tenant-1', 2026);

    expect(findFirstOrder).not.toHaveBeenCalled();
  });

  it('retries after P2002 on order_number and commits the next suffix', async () => {
    const taken = 'PO-2026-0005';
    const used = new Set<string>([taken]);
    let current = 4;
    const purchaseOrder = {
      create: jest.fn(({ data }: { data: { order_number: string } }) => {
        if (used.has(data.order_number)) {
          throw new Prisma.PrismaClientKnownRequestError('Unique', {
            code: 'P2002',
            clientVersion: 'test',
            meta: { target: ['tenant_id', 'order_number'] },
          });
        }
        used.add(data.order_number);
        return Promise.resolve({ id: 'po-new', order_number: data.order_number });
      }),
    };
    const purchaseOrderSequence = {
      findFirst: jest.fn().mockImplementation(async () => ({ current })),
      upsert: jest.fn().mockImplementation(
        async (args: {
          update?: { current?: number | { increment: number } };
          create?: { current: number };
        }) => {
          if (args.update?.current && typeof args.update.current === 'object') {
            current += args.update.current.increment;
          } else if (typeof args.update?.current === 'number') {
            current = args.update.current;
          } else if (args.create) {
            current = args.create.current;
          }
          return { current };
        },
      ),
    };
    const tx = {
      purchaseOrder,
      purchaseOrderSequence,
    };

    const created = await createPurchaseOrderWithAllocatedNumber(
      tx as never,
      'tenant-1',
      new Date('2026-01-01T00:00:00Z'),
      (orderNumber) =>
        tx.purchaseOrder.create({ data: { order_number: orderNumber } }),
    );

    expect(created.order_number).toBe('PO-2026-0006');
    expect(purchaseOrder.create).toHaveBeenCalledTimes(2);
    expect(purchaseOrder.create.mock.calls[0][0].data.order_number).toBe(
      taken,
    );
    expect(used).toContain('PO-2026-0006');
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
