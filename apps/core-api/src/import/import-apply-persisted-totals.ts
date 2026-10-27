import { ImportRowAction, type Prisma } from '@prisma/client';
import type { ImportJobTotals } from './import.types.js';

function totalsFromActionGroups(
  groups: Array<{ action: ImportRowAction; count: number }>,
  expectedRows: number,
  flaggedJumps?: number,
): ImportJobTotals {
  const totals: ImportJobTotals = {
    rows: expectedRows,
    create: 0,
    update: 0,
    skip: 0,
    error: 0,
  };
  if (flaggedJumps !== undefined) {
    totals.flagged_jumps = flaggedJumps;
  }
  for (const group of groups) {
    if (group.action === ImportRowAction.CREATE) totals.create = group.count;
    else if (group.action === ImportRowAction.UPDATE)
      totals.update = group.count;
    else if (group.action === ImportRowAction.SKIP) totals.skip = group.count;
    else if (group.action === ImportRowAction.ERROR) totals.error = group.count;
  }
  return totals;
}

/** Final apply totals from persisted import_job_rows (same transaction as APPLIED). */
export async function tallyImportApplyTotalsFromRows(
  tx: Prisma.TransactionClient,
  tenantId: string,
  jobId: string,
  expectedRows: number,
  preserveFlaggedJumps?: number,
): Promise<ImportJobTotals> {
  const groups = await tx.importJobRow.groupBy({
    by: ['action'],
    where: { tenant_id: tenantId, import_job_id: jobId },
    _count: { _all: true },
  });
  return totalsFromActionGroups(
    groups.map((group) => ({
      action: group.action,
      count: group._count._all,
    })),
    expectedRows,
    preserveFlaggedJumps,
  );
}

export async function readImportJobExpectedRowCount(
  tx: Prisma.TransactionClient,
  tenantId: string,
  jobId: string,
): Promise<{ expectedRows: number; flaggedJumps?: number }> {
  const job = await tx.importJob.findFirst({
    where: { tenant_id: tenantId, id: jobId },
    select: { totals_json: true },
  });
  const stored = (job?.totals_json ?? {}) as ImportJobTotals;
  return {
    expectedRows: stored.rows ?? 0,
    flaggedJumps: stored.flagged_jumps,
  };
}
