import { ImportJobStatus, ImportRowAction } from '@prisma/client';
import { SUPPLIER_PRICE_LIST_ENTITY_TYPE } from './import-undo-plan.js';
import { isDocOrFinancialImport } from './import-undo.guard.js';

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

export type UndoableBatchCheckClient = {
  catalogPriceHistory: {
    findMany: (args: {
      where: {
        tenant_id: string;
        import_job_id: { in: string[] };
      };
      select: { import_job_id: true };
      distinct: ['import_job_id'];
    }) => Promise<{ import_job_id: string | null }[]>;
  };
  importJobRow: {
    findMany: (args: {
      where: {
        tenant_id: string;
        import_job_id: { in: string[] };
        action: { in: ImportRowAction[] };
        entity_id: { not: null };
        undone_at: null;
      };
      select: { import_job_id: true };
      distinct: ['import_job_id'];
    }) => Promise<{ import_job_id: string }[]>;
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

/**
 * Determines whether a job is structurally eligible to be checked for undoable rows.
 */
export function isCandidateUndoableJob(job: {
  status: ImportJobStatus;
  entity_type: string;
  options_json?: unknown;
}): boolean {
  if (
    job.status !== ImportJobStatus.APPLIED &&
    job.status !== ImportJobStatus.PARTIALLY_UNDONE &&
    job.status !== ImportJobStatus.FAILED
  ) {
    return false;
  }
  if (isDocOrFinancialImport(job.entity_type)) {
    return false;
  }
  const options = (job.options_json ?? {}) as Record<string, unknown>;
  if (options.rows_purged === true || options.cancel_reason === 'expired') {
    return false;
  }
  return true;
}

/**
 * Computes which job IDs on a page are undoable using at most one batched query per table (no N+1).
 */
export async function findUndoableJobIds(
  prisma: UndoableBatchCheckClient,
  tenantId: string,
  jobs: Array<{
    id: string;
    status: ImportJobStatus;
    entity_type: string;
    options_json?: unknown;
  }>,
): Promise<Set<string>> {
  const candidateJobs = jobs.filter(isCandidateUndoableJob);
  if (candidateJobs.length === 0) {
    return new Set();
  }

  const standardJobIds = candidateJobs
    .filter((j) => j.entity_type !== SUPPLIER_PRICE_LIST_ENTITY_TYPE)
    .map((j) => j.id);
  const priceListJobIds = candidateJobs
    .filter((j) => j.entity_type === SUPPLIER_PRICE_LIST_ENTITY_TYPE)
    .map((j) => j.id);

  const undoableIds = new Set<string>();

  if (standardJobIds.length > 0) {
    const rows = await prisma.importJobRow.findMany({
      where: {
        tenant_id: tenantId,
        import_job_id: { in: standardJobIds },
        action: { in: [ImportRowAction.CREATE, ImportRowAction.UPDATE] },
        entity_id: { not: null },
        undone_at: null,
      },
      select: { import_job_id: true },
      distinct: ['import_job_id'],
    });
    for (const r of rows) {
      undoableIds.add(r.import_job_id);
    }
  }

  if (priceListJobIds.length > 0) {
    const priceHistories = await prisma.catalogPriceHistory.findMany({
      where: {
        tenant_id: tenantId,
        import_job_id: { in: priceListJobIds },
      },
      select: { import_job_id: true },
      distinct: ['import_job_id'],
    });
    for (const ph of priceHistories) {
      if (ph.import_job_id) {
        undoableIds.add(ph.import_job_id);
      }
    }
  }

  return undoableIds;
}
