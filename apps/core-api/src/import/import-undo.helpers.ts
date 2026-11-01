import { ImportRowAction } from '@prisma/client';
import { SUPPLIER_PRICE_LIST_ENTITY_TYPE } from './import-undo-plan.js';

export type UndoableRowCheckClient = {
  catalogPriceHistory: {
    findFirst: (args: {
      where: { tenant_id: string; import_job_id: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
  importJobRow: {
    findFirst: (args: {
      where: {
        tenant_id: string;
        import_job_id: string;
        action: { in: ImportRowAction[] };
        entity_id: { not: null };
        undone_at: null;
      };
      select: { row_no: true };
    }) => Promise<{ row_no: number } | null>;
  };
};

/**
 * Checks whether this job has at least one applied row that has not yet been undone.
 * Runs one indexed existence query with early exit (never N+1).
 */
export async function hasUndoableRows(
  prisma: UndoableRowCheckClient,
  tenantId: string,
  job: { id: string; entity_type: string },
): Promise<boolean> {
  if (job.entity_type === SUPPLIER_PRICE_LIST_ENTITY_TYPE) {
    const history = await prisma.catalogPriceHistory.findFirst({
      where: { tenant_id: tenantId, import_job_id: job.id },
      select: { id: true },
    });
    return history !== null;
  }
  const row = await prisma.importJobRow.findFirst({
    where: {
      tenant_id: tenantId,
      import_job_id: job.id,
      action: { in: [ImportRowAction.CREATE, ImportRowAction.UPDATE] },
      entity_id: { not: null },
      undone_at: null,
    },
    select: { row_no: true },
  });
  return row !== null;
}
