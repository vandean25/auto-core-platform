import { UnprocessableEntityException } from '@nestjs/common';
import { lockFinanceSettingsAndAssertOpen } from './fiscal-lock.helpers.js';

describe('lockFinanceSettingsAndAssertOpen', () => {
  const tx = {
    $queryRaw: jest.fn(),
    financeSettings: {
      findFirst: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tx.$queryRaw.mockResolvedValue([]);
  });

  it('allows dates after the lock date', async () => {
    tx.financeSettings.findFirst.mockResolvedValue({
      lock_date: new Date('2026-01-01'),
    });

    await expect(
      lockFinanceSettingsAndAssertOpen(
        tx as never,
        'tenant-1',
        new Date('2026-02-01'),
      ),
    ).resolves.toBeUndefined();
  });

  it('rejects dates on or before the lock date with FISCAL_PERIOD_LOCKED', async () => {
    tx.financeSettings.findFirst.mockResolvedValue({
      lock_date: new Date('2026-06-30'),
    });

    await expect(
      lockFinanceSettingsAndAssertOpen(
        tx as never,
        'tenant-1',
        new Date('2026-06-01'),
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'FISCAL_PERIOD_LOCKED',
      },
    });
  });

  it('allows any date when lock_date is unset', async () => {
    tx.financeSettings.findFirst.mockResolvedValue({ lock_date: null });

    await expect(
      lockFinanceSettingsAndAssertOpen(
        tx as never,
        'tenant-1',
        new Date('2020-01-01'),
      ),
    ).resolves.toBeUndefined();
  });

  it('locks the finance settings row before reading lock_date', async () => {
    tx.financeSettings.findFirst.mockResolvedValue({ lock_date: null });

    await lockFinanceSettingsAndAssertOpen(
      tx as never,
      'tenant-1',
      new Date('2026-06-01'),
    );

    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.financeSettings.findFirst).toHaveBeenCalled();
  });
});
