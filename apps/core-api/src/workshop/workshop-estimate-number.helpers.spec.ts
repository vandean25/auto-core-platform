import type { Prisma } from '@prisma/client';
import {
  calendarYearInVienna,
  generateWorkshopEstimateNumber,
} from './workshop-estimate-number.helpers.js';

describe('workshop estimate numbering', () => {
  it('reads the calendar year in Vienna business time', () => {
    expect(calendarYearInVienna(new Date('2026-12-31T23:30:00.000Z'))).toBe(
      2027,
    );
    expect(calendarYearInVienna(new Date('2026-06-15T12:00:00.000Z'))).toBe(
      2026,
    );
  });

  it('issues KV-YYYY-XXXX from the tenant and year counter', async () => {
    const upsert = jest.fn().mockResolvedValue({ current: 7 });
    const tx = {
      workshopEstimateSequence: { upsert },
    } as unknown as Prisma.TransactionClient;

    await expect(
      generateWorkshopEstimateNumber(tx, 'tenant-1', 2026),
    ).resolves.toBe('KV-2026-0007');
    expect(upsert).toHaveBeenCalledWith({
      where: { tenant_id_year: { tenant_id: 'tenant-1', year: 2026 } },
      update: { current: { increment: 1 } },
      create: { tenant_id: 'tenant-1', year: 2026, current: 1 },
    });
  });
});
