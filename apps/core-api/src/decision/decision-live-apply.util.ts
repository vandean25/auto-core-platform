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

export async function updateImportJobTotals(
  tx: Prisma.TransactionClient,
  params: { tenantId: string; jobId: string; totals: ImportJobTotals },
): Promise<void> {
  await tx.importJob.updateMany({
    where: {
      tenant_id: params.tenantId,
      id: params.jobId,
      status: ImportJobStatus.DRY_RUN_DONE,
    },
    data: { totals_json: params.totals },
  });
}

export function adjustImportTotalsForAdoptedRows(
  totals: ImportJobTotals,
  adoptedRowCount: number,
): ImportJobTotals {
  return {
    ...totals,
    create: totals.create - adoptedRowCount,
    update: totals.update + adoptedRowCount,
  };
}

export function readImportJobTotals(
  value: Prisma.JsonValue | null,
): ImportJobTotals | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const keys = ['rows', 'create', 'update', 'skip', 'error'] as const;
  if (!keys.every((key) => typeof record[key] === 'number')) {
    return null;
  }
  return {
    rows: record.rows as number,
    create: record.create as number,
    update: record.update as number,
    skip: record.skip as number,
    error: record.error as number,
  };
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
