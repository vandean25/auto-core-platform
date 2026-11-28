import { jest } from '@jest/globals';
import { ImportRowAction } from '@prisma/client';
import { importTotalsAfterApplyRowTally } from './import-totals.util.js';
import { tallyImportDryRunTotalsFromRows } from './import-dry-run-reconcile.totals.js';

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

describe('tallyImportDryRunTotalsFromRows', () => {
  it('computes custom_field_counts from reconciled rows and mapping', async () => {
    const prisma = {
      importJobRow: {
        findMany: jest.fn(async () => [
          {
            action: ImportRowAction.CREATE,
            normalized_json: { custom_fields: { tier: 'Gold' } },
            warnings_json: [],
          },
          {
            action: ImportRowAction.ERROR,
            normalized_json: { custom_fields: { tier: 'Ignored' } },
            warnings_json: [],
          },
        ]),
      },
    } as never;

    const totals = await tallyImportDryRunTotalsFromRows(
      prisma,
      'tenant-1',
      'job-1',
      2,
      { external_id: 'ID', 'custom_fields.tier': 'Tier' },
    );

    expect(totals).toEqual({
      rows: 2,
      create: 1,
      update: 0,
      skip: 0,
      error: 1,
      flagged_jumps: 0,
      custom_field_counts: { tier: 1 },
    });
  });
});
