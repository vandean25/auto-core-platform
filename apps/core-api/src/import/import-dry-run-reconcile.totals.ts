import type { Prisma } from '@prisma/client';
import { computeDryRunTotals } from './import-totals.util.js';
import type { ImportJobTotals } from './import.types.js';

/** Recomputes dry-run totals from persisted import_job_rows after reconcile overwrites. */
export async function tallyImportDryRunTotalsFromRows(
  prisma: Prisma.TransactionClient,
  tenantId: string,
  jobId: string,
  expectedRows: number,
  mapping?: Record<string, string>,
): Promise<ImportJobTotals> {
  const rows = await prisma.importJobRow.findMany({
    where: { tenant_id: tenantId, import_job_id: jobId },
    select: {
      action: true,
      normalized_json: true,
      warnings_json: true,
    },
  });
  const totals = computeDryRunTotals(
    rows.map((row) => ({
      action: row.action,
      normalized: row.normalized_json as Record<string, unknown> | null,
      warnings: Array.isArray(row.warnings_json)
        ? (row.warnings_json as Array<{ code?: string }>)
        : undefined,
    })),
    mapping,
  );
  totals.rows = expectedRows;
  return totals;
}
