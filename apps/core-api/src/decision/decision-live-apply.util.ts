import {
  DocumentBrandAssetState,
  ImportJobStatus,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import { chunkedPromiseAll } from '../common/utils/promise.util.js';
import type { ImportJobTotals } from '../import/import.types.js';
import type { DocumentSortType } from './decision.constants.js';

export type ImportRowMatchChange = {
  row_no: number;
  customer_id: string;
};

/**
 * Shared write for AUT-413 import matches, used by live AUTO and by approval of
 * a PROPOSE action. Only CREATE rows of a dry-run job are changed, so a row that
 * changed since the suggestion was made is left alone. Returns applied row numbers.
 */
export async function applyImportRowMatchChanges(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    jobId: string;
    changes: ImportRowMatchChange[];
  },
): Promise<number[]> {
  const results = await chunkedPromiseAll(
    params.changes,
    (change) =>
      tx.importJobRow.updateMany({
        where: {
          tenant_id: params.tenantId,
          import_job_id: params.jobId,
          row_no: change.row_no,
          action: ImportRowAction.CREATE,
        },
        data: {
          action: ImportRowAction.UPDATE,
          entity_id: change.customer_id,
        },
      }),
    50,
  );
  return params.changes
    .filter((_change, index) => results[index].count === 1)
    .map((change) => change.row_no);
}

/** Returns false when the job is no longer awaiting confirmation. */
async function updateImportJobTotals(
  tx: Prisma.TransactionClient,
  params: { tenantId: string; jobId: string; totals: ImportJobTotals },
): Promise<boolean> {
  const updated = await tx.importJob.updateMany({
    where: {
      tenant_id: params.tenantId,
      id: params.jobId,
      status: ImportJobStatus.DRY_RUN_DONE,
    },
    data: { totals_json: params.totals },
  });
  return updated.count === 1;
}

/**
 * Recounts a dry-run job's totals from its rows instead of adjusting a stored
 * snapshot. The job row is written first and takes its row lock, so concurrent
 * approvals on the same job queue here. Each recount then sees the committed row
 * changes of the others. Returns null when the job is no longer awaiting
 * confirmation, so the caller can roll back.
 */
export async function refreshImportJobTotals(
  tx: Prisma.TransactionClient,
  params: { tenantId: string; jobId: string },
): Promise<ImportJobTotals | null> {
  const job = await tx.importJob.findFirst({
    where: {
      tenant_id: params.tenantId,
      id: params.jobId,
      status: ImportJobStatus.DRY_RUN_DONE,
    },
    select: { totals_json: true },
  });
  if (!job) {
    return null;
  }
  const locked = await tx.importJob.updateMany({
    where: {
      tenant_id: params.tenantId,
      id: params.jobId,
      status: ImportJobStatus.DRY_RUN_DONE,
    },
    data: { totals_json: job.totals_json as Prisma.InputJsonValue },
  });
  if (locked.count !== 1) {
    return null;
  }
  const groups = await tx.importJobRow.groupBy({
    by: ['action'],
    where: { tenant_id: params.tenantId, import_job_id: params.jobId },
    _count: { _all: true },
  });
  const totals = countImportTotals(
    groups.map((group) => ({ action: group.action, count: group._count._all })),
  );
  const written = await updateImportJobTotals(tx, { ...params, totals });
  return written ? totals : null;
}

function countImportTotals(
  groups: Array<{ action: ImportRowAction; count: number }>,
): ImportJobTotals {
  const totals: ImportJobTotals = {
    rows: 0,
    create: 0,
    update: 0,
    skip: 0,
    error: 0,
  };
  for (const group of groups) {
    totals.rows += group.count;
    if (group.action === ImportRowAction.CREATE) totals.create += group.count;
    if (group.action === ImportRowAction.UPDATE) totals.update += group.count;
    if (group.action === ImportRowAction.SKIP) totals.skip += group.count;
    if (group.action === ImportRowAction.ERROR) totals.error += group.count;
  }
  return totals;
}

/**
 * Sets the document type on a READY branding asset. Writes only when the type
 * is still unset, so an earlier decision is never overwritten.
 */
export async function applyDocumentSortType(
  tx: Prisma.TransactionClient,
  params: { tenantId: string; assetId: string; sortType: DocumentSortType },
): Promise<boolean> {
  const updated = await tx.documentBrandAsset.updateMany({
    where: {
      id: params.assetId,
      tenant_id: params.tenantId,
      state: DocumentBrandAssetState.READY,
      document_sort_type: null,
    },
    data: { document_sort_type: params.sortType },
  });
  return updated.count === 1;
}
