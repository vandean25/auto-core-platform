import { ImportEntityType } from '@prisma/client';
import { computeImportDryRunReconcileRanges } from './import-dry-run-reconcile.groups.js';

describe('computeImportDryRunReconcileRanges', () => {
  const tenantId = 'tenant-1';
  const jobId = 'job-1';

  function prismaWithSpans(spans: { min_row: number; max_row: number }[]) {
    return {
      $queryRaw: jest.fn(async () => spans),
    } as never;
  }

  it('returns no ranges when duplicate external ids stay within one batch', async () => {
    const prisma = prismaWithSpans([{ min_row: 1, max_row: 2 }]);
    const ranges = await computeImportDryRunReconcileRanges(prisma, {
      tenantId,
      jobId,
      entityType: ImportEntityType.CUSTOMER,
      batchSize: 500,
    });
    expect(ranges).toEqual([]);
  });

  it('merges overlapping reconcile windows for cross-batch duplicates', async () => {
    const prisma = prismaWithSpans([
      { min_row: 10, max_row: 510 },
      { min_row: 500, max_row: 511 },
    ]);
    const ranges = await computeImportDryRunReconcileRanges(prisma, {
      tenantId,
      jobId,
      entityType: ImportEntityType.VEHICLE_PARTY,
      batchSize: 500,
    });
    expect(ranges).toEqual([{ from_row: 10, to_row: 511 }]);
  });
});
