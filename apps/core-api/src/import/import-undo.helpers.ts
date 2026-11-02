import { ImportJobStatus, ImportRowAction, Prisma } from '@prisma/client';
import { SUPPLIER_PRICE_LIST_ENTITY_TYPE } from './import-undo-plan.js';
import { isDocOrFinancialImport } from './import-undo.guard.js';

export type UndoableRowCheckClient = {
  catalogPriceHistory: {
    findFirst: (args: {
      where: {
        tenant_id: string;
        import_job_id: string;
        old_cost: { not: null };
      };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
  importJobRow: {
    findFirst: (args: {
      where: {
        tenant_id: string;
        import_job_id: string;
        action?: { in: ImportRowAction[] };
        entity_id?: { not: null };
        undone_at?: null;
      };
      select: { row_no: true };
    }) => Promise<{ row_no: number } | null>;
  };
};

export type UndoableBatchCheckClient = {
  $queryRaw: <T = unknown>(query: Prisma.Sql) => Promise<T>;
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
      where: {
        tenant_id: tenantId,
        import_job_id: job.id,
        old_cost: { not: null },
      },
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
 * Checks whether any staged row still exists for the job (any action, undone or not).
 * The retention purge marks jobs with `rows_purged`, but it deletes the rows of ancient
 * jobs without the mark; missing staged rows then prove the undo basis was purged.
 */
export async function hasStagedImportJobRows(
  prisma: UndoableRowCheckClient,
  tenantId: string,
  jobId: string,
): Promise<boolean> {
  const row = await prisma.importJobRow.findFirst({
    where: { tenant_id: tenantId, import_job_id: jobId },
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

type PageJob = {
  id: string;
  status: ImportJobStatus;
  entity_type: string;
  options_json?: unknown;
};

type BatchedJobIds = {
  standardJobIds: string[];
  priceListJobIds: string[];
};

type UndoableJobIdRow = { import_job_id: string | null };

/** Existence probe per job id: stops at the first undoable row of each job. */
function undoableRowJobIdsSql(tenantId: string, jobIds: string[]): Prisma.Sql {
  return Prisma.sql`
    SELECT j.id AS import_job_id
    FROM unnest(ARRAY[${Prisma.join(jobIds)}]::text[]) AS j(id)
    WHERE EXISTS (
      SELECT 1
      FROM import_job_rows r
      WHERE r.tenant_id = ${tenantId}
        AND r.import_job_id = j.id
        AND r.action IN ('CREATE'::"ImportRowAction", 'UPDATE'::"ImportRowAction")
        AND r.entity_id IS NOT NULL
        AND r.undone_at IS NULL
    )
  `;
}

/** Existence probe per job id: only price changes with a prior cost can be reverted. */
function undoablePriceHistoryJobIdsSql(
  tenantId: string,
  jobIds: string[],
): Prisma.Sql {
  return Prisma.sql`
    SELECT j.id AS import_job_id
    FROM unnest(ARRAY[${Prisma.join(jobIds)}]::text[]) AS j(id)
    WHERE EXISTS (
      SELECT 1
      FROM catalog_price_histories h
      WHERE h.tenant_id = ${tenantId}
        AND h.import_job_id = j.id
        AND h.old_cost IS NOT NULL
    )
  `;
}

function groupJobIdsByUndoPath(jobs: PageJob[]): BatchedJobIds {
  const groups: BatchedJobIds = { standardJobIds: [], priceListJobIds: [] };
  for (const job of jobs) {
    const bucket =
      job.entity_type === SUPPLIER_PRICE_LIST_ENTITY_TYPE
        ? groups.priceListJobIds
        : groups.standardJobIds;
    bucket.push(job.id);
  }
  return groups;
}

function collectJobIds(target: Set<string>, rows: UndoableJobIdRow[]): void {
  for (const row of rows) {
    if (row.import_job_id) {
      target.add(row.import_job_id);
    }
  }
}

async function findUndoableJobIdsRaw(
  prisma: UndoableBatchCheckClient,
  tenantId: string,
  groups: BatchedJobIds,
): Promise<Set<string>> {
  const undoableIds = new Set<string>();
  if (groups.standardJobIds.length > 0) {
    // eslint-disable-next-line no-restricted-syntax -- AUT-846: findMany/groupBy/distinct cannot express a per-job EXISTS with early exit and would scan every matching row of large jobs; tenant_id bound in both predicates, ids via Prisma.join.
    const standardRows = await prisma.$queryRaw<UndoableJobIdRow[]>(
      undoableRowJobIdsSql(tenantId, groups.standardJobIds),
    );
    collectJobIds(undoableIds, standardRows);
  }
  if (groups.priceListJobIds.length > 0) {
    // eslint-disable-next-line no-restricted-syntax -- AUT-846: findMany/groupBy/distinct cannot express a per-job EXISTS with early exit and would scan every matching row of large jobs; tenant_id bound in both predicates, ids via Prisma.join.
    const priceListRows = await prisma.$queryRaw<UndoableJobIdRow[]>(
      undoablePriceHistoryJobIdsSql(tenantId, groups.priceListJobIds),
    );
    collectJobIds(undoableIds, priceListRows);
  }
  return undoableIds;
}

/**
 * Computes which job IDs on a page are undoable using at most one batched query per table (no N+1).
 * Uses a raw SQL existence probe with early exit per job to avoid scanning all rows of large jobs.
 */
export async function findUndoableJobIds(
  prisma: UndoableBatchCheckClient,
  tenantId: string,
  jobs: PageJob[],
): Promise<Set<string>> {
  const groups = groupJobIdsByUndoPath(jobs.filter(isCandidateUndoableJob));
  if (
    groups.standardJobIds.length === 0 &&
    groups.priceListJobIds.length === 0
  ) {
    return new Set();
  }
  return findUndoableJobIdsRaw(prisma, tenantId, groups);
}
