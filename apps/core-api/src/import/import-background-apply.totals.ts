import { ImportRowAction, type Prisma } from '@prisma/client';
import type { ImportJobTotals } from './import.types.js';

type ApplyTotalsDb = Pick<Prisma.TransactionClient, 'importJobRow'>;

/** True when per-row apply totals account for every planned row once. */
export async function isBackgroundApplyOutcomeComplete(
  db: ApplyTotalsDb,
  params: { tenantId: string; jobId: string },
  totals: ImportJobTotals,
): Promise<boolean> {
  if (typeof db.importJobRow.count !== 'function') {
    return true;
  }
  const rowWhere = {
    tenant_id: params.tenantId,
    import_job_id: params.jobId,
  };
  const [rowCount, plannedCreates, plannedUpdates] = await Promise.all([
    db.importJobRow.count({ where: rowWhere }),
    db.importJobRow.count({
      where: { ...rowWhere, action: ImportRowAction.CREATE },
    }),
    db.importJobRow.count({
      where: { ...rowWhere, action: ImportRowAction.UPDATE },
    }),
  ]);
  if (rowCount === 0) {
    return false;
  }
  const accounted = totals.create + totals.update + totals.skip + totals.error;
  if (accounted < rowCount) {
    return false;
  }
  if (plannedCreates > 0 && totals.create + totals.error < plannedCreates) {
    return false;
  }
  if (plannedUpdates > 0 && totals.update + totals.error < plannedUpdates) {
    return false;
  }
  return accounted >= rowCount;
}
