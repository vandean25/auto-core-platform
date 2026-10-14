import { upsertTargetExists } from './prisma-dashboard-realtime.upsert.js';

describe('upsertTargetExists', () => {
  it('asks the camelCase model delegate whether the where clause matches a row', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'cust-1' });
    const where = { tenant_id: 'tenant-1', email: 'ada@example.com' };

    await expect(
      upsertTargetExists({ customer: { findFirst } }, 'Customer', where),
    ).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({ where, select: { id: true } });
  });

  it('returns false when no row matches', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);

    await expect(
      upsertTargetExists({ customer: { findFirst } }, 'Customer', {}),
    ).resolves.toBe(false);
  });

  it('prefers the camelCase delegate over a raw model key of the same model', async () => {
    const camelCaseFindFirst = jest.fn().mockResolvedValue(null);
    const rawFindFirst = jest.fn().mockResolvedValue({ id: 'wo-1' });

    await expect(
      upsertTargetExists(
        {
          workshopOrder: { findFirst: camelCaseFindFirst },
          WorkshopOrder: { findFirst: rawFindFirst },
        },
        'WorkshopOrder',
        {},
      ),
    ).resolves.toBe(false);
    expect(camelCaseFindFirst).toHaveBeenCalledTimes(1);
    expect(rawFindFirst).not.toHaveBeenCalled();
  });

  it('falls back to the raw model key when there is no camelCase delegate', async () => {
    const rawFindFirst = jest.fn().mockResolvedValue({ id: 'wo-1' });

    await expect(
      upsertTargetExists(
        { WorkshopOrder: { findFirst: rawFindFirst } },
        'WorkshopOrder',
        {},
      ),
    ).resolves.toBe(true);
  });

  it('returns false without querying when the delegate has no findFirst', async () => {
    await expect(
      upsertTargetExists({ customer: {} }, 'Customer', {}),
    ).resolves.toBe(false);
    await expect(upsertTargetExists({}, 'Customer', {})).resolves.toBe(false);
  });
});
