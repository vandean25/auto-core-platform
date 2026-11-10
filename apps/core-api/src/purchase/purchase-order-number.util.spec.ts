import { allocatePurchaseOrderNumber } from './purchase-order-number.util.js';

describe('allocatePurchaseOrderNumber', () => {
  it('formats PO-YYYY-NNNN from the tenant/year sequence counter', async () => {
    const upsert = jest.fn().mockResolvedValue({ current: 42 });
    const tx = {
      purchaseOrderSequence: { upsert },
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
});
