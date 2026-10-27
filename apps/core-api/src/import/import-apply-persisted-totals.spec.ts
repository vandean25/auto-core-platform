import { ImportRowAction } from '@prisma/client';
import { tallyImportApplyTotalsFromRows } from './import-apply-persisted-totals.js';

describe('tallyImportApplyTotalsFromRows', () => {
  it('counts actions via groupBy and keeps the dry-run row count', async () => {
    const groupBy = jest.fn(async () => [
      { action: ImportRowAction.CREATE, _count: { _all: 2 } },
      { action: ImportRowAction.ERROR, _count: { _all: 1 } },
    ]);
    const tx = { importJobRow: { groupBy } };
    const totals = await tallyImportApplyTotalsFromRows(
      tx as never,
      'tenant-1',
      'job-1',
      3,
      4,
    );
    expect(groupBy).toHaveBeenCalledWith({
      by: ['action'],
      where: { tenant_id: 'tenant-1', import_job_id: 'job-1' },
      _count: { _all: true },
    });
    expect(totals).toEqual({
      rows: 3,
      create: 2,
      update: 0,
      skip: 0,
      error: 1,
      flagged_jumps: 4,
    });
  });
});
