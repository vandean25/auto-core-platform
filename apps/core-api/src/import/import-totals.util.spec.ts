import { ImportRowAction } from '@prisma/client';
import { importTotalsAfterApplyRowTally } from './import-totals.util.js';

describe('importTotalsAfterApplyRowTally', () => {
  it('counts a noop CREATE as create once', () => {
    const totals = { rows: 3, create: 0, update: 0, skip: 0, error: 0 };
    const next = importTotalsAfterApplyRowTally(
      totals,
      ImportRowAction.CREATE,
      'noop',
    );
    expect(next.create).toBe(1);
    expect(next.update).toBe(0);
  });

  it('counts a written UPDATE without incrementing create', () => {
    const totals = { rows: 1, create: 0, update: 0, skip: 0, error: 0 };
    const next = importTotalsAfterApplyRowTally(
      totals,
      ImportRowAction.UPDATE,
      'written',
    );
    expect(next).toEqual({ rows: 1, create: 0, update: 1, skip: 0, error: 0 });
  });
});
