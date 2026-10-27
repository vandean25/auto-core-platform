import {
  ImportRowAction,
  type ImportEntityType,
  type Prisma,
} from '@prisma/client';
import type { ImportJobTotals } from './import.types.js';

type ApplyTotalsDb = Pick<
  Prisma.TransactionClient,
  'externalIdMapping' | 'importJobRow'
>;

/** Align apply totals with committed mappings and ERROR rows when a job finishes. */
export async function reconcileFinishedApplyTotals(
  db: ApplyTotalsDb,
  params: {
    tenantId: string;
    jobId: string;
    entityType: ImportEntityType;
  },
  totals: ImportJobTotals,
): Promise<ImportJobTotals> {
  if (
    typeof db.externalIdMapping.count !== 'function' ||
    typeof db.importJobRow.count !== 'function'
  ) {
    return totals;
  }
  const [createFromMappings, errorRows] = await Promise.all([
    db.externalIdMapping.count({
      where: {
        tenant_id: params.tenantId,
        first_seen_import_job_id: params.jobId,
        entity_type: params.entityType,
      },
    }),
    db.importJobRow.count({
      where: {
        tenant_id: params.tenantId,
        import_job_id: params.jobId,
        action: ImportRowAction.ERROR,
      },
    }),
  ]);
  return {
    ...totals,
    create: Math.max(totals.create, createFromMappings),
    error: Math.max(totals.error, errorRows),
  };
}

/** True when apply totals account for every row and CREATE rows are written or ERROR. */
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
  const [rowCount, plannedCreates] = await Promise.all([
    db.importJobRow.count({ where: rowWhere }),
    db.importJobRow.count({
      where: { ...rowWhere, action: ImportRowAction.CREATE },
    }),
  ]);
  if (rowCount === 0) {
    return false;
  }
  const accounted = totals.create + totals.update + totals.skip + totals.error;
  if (accounted < rowCount) {
    return false;
  }
  if (plannedCreates === 0) {
    return accounted >= rowCount;
  }
  if (typeof db.externalIdMapping.count === 'function') {
    const createFromMappings = await db.externalIdMapping.count({
      where: {
        tenant_id: params.tenantId,
        first_seen_import_job_id: params.jobId,
      },
    });
    if (createFromMappings + totals.error < plannedCreates) {
      return false;
    }
  }
  return totals.create >= plannedCreates || totals.error >= plannedCreates;
}
