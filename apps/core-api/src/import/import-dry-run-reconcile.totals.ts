import { ImportRowAction, Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import type { ImportJobTotals } from './import.types.js';

function isPriceJumpFlagged(normalized: Prisma.JsonValue | null): boolean {
  if (
    !normalized ||
    typeof normalized !== 'object' ||
    Array.isArray(normalized)
  ) {
    return false;
  }
  return (normalized as Record<string, unknown>).price_jump_flagged === true;
}

/** Recomputes dry-run totals from persisted import_job_rows after reconcile overwrites. */
export async function tallyImportDryRunTotalsFromRows(
  prisma: PrismaService,
  tenantId: string,
  jobId: string,
  expectedRows: number,
): Promise<ImportJobTotals> {
  const rows = await prisma.importJobRow.findMany({
    where: { tenant_id: tenantId, import_job_id: jobId },
    select: {
      action: true,
      normalized_json: true,
      warnings_json: true,
    },
  });
  const totals: ImportJobTotals = {
    rows: expectedRows,
    create: 0,
    update: 0,
    skip: 0,
    error: 0,
    flagged_jumps: 0,
  };
  for (const row of rows) {
    if (row.action === ImportRowAction.CREATE) totals.create += 1;
    else if (row.action === ImportRowAction.UPDATE) totals.update += 1;
    else if (row.action === ImportRowAction.SKIP) totals.skip += 1;
    else if (row.action === ImportRowAction.ERROR) totals.error += 1;
    if (isPriceJumpFlagged(row.normalized_json)) {
      totals.flagged_jumps = (totals.flagged_jumps ?? 0) + 1;
    } else if (Array.isArray(row.warnings_json)) {
      const flagged = row.warnings_json.some(
        (warning) =>
          typeof warning === 'object' &&
          warning !== null &&
          (warning as { code?: string }).code ===
            IMPORT_ERROR_CODES.PRICE_JUMP_EXCEEDED,
      );
      if (flagged) {
        totals.flagged_jumps = (totals.flagged_jumps ?? 0) + 1;
      }
    }
  }
  return totals;
}
