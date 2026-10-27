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
