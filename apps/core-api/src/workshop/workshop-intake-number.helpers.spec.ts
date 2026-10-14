import { generateNextWorkshopOrderNumber } from './workshop-intake-number.helpers.js';

describe('generateNextWorkshopOrderNumber', () => {
  const currentYear = new Date().getFullYear();

  function buildDb(nextWorkshopOrderNumber: number) {
    return {
      financeSettings: {
        upsert: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({
          next_workshop_order_number: nextWorkshopOrderNumber,
        }),
      },
    } as any;
  }

  it('seeds the tenant finance settings with the current-year prefix before incrementing', async () => {
    const db = buildDb(2);

    await generateNextWorkshopOrderNumber(db, 'tenant-1');

    expect(db.financeSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenant_id: 'tenant-1' },
        update: {},
        create: expect.objectContaining({
          tenant_id: 'tenant-1',
          next_workshop_order_number: 1,
          workshop_order_prefix: `WO-${currentYear}-`,
        }),
      }),
    );
    expect(db.financeSettings.upsert.mock.invocationCallOrder[0]).toBeLessThan(
      db.financeSettings.update.mock.invocationCallOrder[0],
    );
  });

  it('increments the tenant workshop order counter and reads back the consumed value', async () => {
    const db = buildDb(2);

    await generateNextWorkshopOrderNumber(db, 'tenant-1');

    expect(db.financeSettings.update).toHaveBeenCalledWith({
      where: { tenant_id: 'tenant-1' },
      data: {
        next_workshop_order_number: { increment: 1 },
        workshop_order_prefix: `WO-${currentYear}-`,
      },
      select: { next_workshop_order_number: true },
    });
  });

  it('pads the consumed sequence to four digits behind the prefix', async () => {
    await expect(
      generateNextWorkshopOrderNumber(buildDb(2), 'tenant-1'),
    ).resolves.toBe(`WO-${currentYear}-0001`);
  });

  it('keeps sequences of four or more digits intact', async () => {
    await expect(
      generateNextWorkshopOrderNumber(buildDb(1011), 'tenant-1'),
    ).resolves.toBe(`WO-${currentYear}-1010`);
  });
});
