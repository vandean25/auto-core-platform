import { Prisma, WorkshopLineItemType } from '@prisma/client';
import {
  LOANER_FEE_DESCRIPTION,
  LOANER_FEE_ITEM_NO,
  buildLoanerFeeLineItemData,
  resolveLoanerFeeQuantityDays,
} from './workshop-loaner-fee.helpers.js';

describe('workshop-loaner-fee.helpers', () => {
  it('defaults loaner days from the booking window', () => {
    expect(
      resolveLoanerFeeQuantityDays(
        '2026-10-12T09:00:00.000Z',
        '2026-10-14T09:00:00.000Z',
      ),
    ).toBe(2);
    expect(
      resolveLoanerFeeQuantityDays(
        '2026-10-12T09:00:00.000Z',
        '2026-10-12T10:00:00.000Z',
      ),
    ).toBe(1);
  });

  it('honors quantity_days override', () => {
    expect(
      resolveLoanerFeeQuantityDays(
        '2026-10-12T09:00:00.000Z',
        '2026-10-12T10:00:00.000Z',
        5,
      ),
    ).toBe(5);
  });

  it('builds a FEE line for Leihwagen', () => {
    const row = buildLoanerFeeLineItemData({
      tenantId: 'tenant-1',
      workshopTaskId: 'task-1',
      unitPriceCents: 4500,
      quantityDays: 3,
    });
    expect(row.type).toBe(WorkshopLineItemType.FEE);
    expect(row.item_no).toBe(LOANER_FEE_ITEM_NO);
    expect(row.description).toBe(LOANER_FEE_DESCRIPTION);
    expect(
      new Prisma.Decimal((row.quantity ?? 0) as string | number | Prisma.Decimal).toString(),
    ).toBe('3');
    expect(
      new Prisma.Decimal((row.unit_price ?? 0) as string | number | Prisma.Decimal).toString(),
    ).toBe('45');
  });
});
