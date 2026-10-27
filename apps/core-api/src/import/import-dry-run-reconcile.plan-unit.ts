import type { PrismaService } from '../prisma/prisma.service.js';
import type { ImportFileStorageService } from './import-file.storage.js';
import type {
  ImportDryRunInput,
  ImportTypeHandler,
} from './import-type-handler.js';
import type { DryRunRowResult } from './import.types.js';
import type { ImportDryRunReconcileUnit } from './import-job.worker-state.js';
import type { ImportJobUploadRef } from './import-job.worker-state.js';
import {
  loadCsvRowRecords,
  toParsedCsvFromRecords,
} from './import-dry-run-reconcile.records.js';
import {
  dryRunImportGroupTooLargeRow,
  IMPORT_RECONCILE_GROUP_MAX_ROWS,
} from './import-dry-run-group-limit.js';
import { readImportCsvDataRowSlice } from './import-csv-stream.util.js';

async function loadFileHeaders(
  fileStorage: ImportFileStorageService,
  upload: ImportJobUploadRef,
  fileSha256: string,
): Promise<string[]> {
  const head = await readImportCsvDataRowSlice(
    fileStorage.openReadStream(upload),
    0,
    1,
    fileSha256,
  );
  return head?.headers ?? [];
}

/** Re-plans one reconcile unit (single key group) with the same planner as sync. */
export async function replanImportDryRunUnit(params: {
  prisma: PrismaService;
  fileStorage: ImportFileStorageService;
  upload: ImportJobUploadRef;
  fileSha256: string;
  tenantId: string;
  jobId: string;
  handler: ImportTypeHandler;
  input: ImportDryRunInput;
  unit: ImportDryRunReconcileUnit;
}): Promise<DryRunRowResult[]> {
  const rowNos = [...params.unit.replan_row_nos].sort((a, b) => a - b);
  if (rowNos.length > IMPORT_RECONCILE_GROUP_MAX_ROWS) {
    const stored = await params.prisma.importJobRow.findMany({
      where: {
        tenant_id: params.tenantId,
        import_job_id: params.jobId,
        row_no: { in: rowNos },
      },
      select: { row_no: true, external_id: true },
    });
    const externalByRow = new Map(
      stored.map((row) => [row.row_no, row.external_id]),
    );
    return rowNos.map((rowNo) =>
      dryRunImportGroupTooLargeRow(rowNo, externalByRow.get(rowNo) ?? null),
    );
  }

  const records = await loadCsvRowRecords(
    params.fileStorage,
    params.upload,
    params.fileSha256,
    rowNos,
  );
  if (records.length === 0) {
    return [];
  }

  const headers = await loadFileHeaders(
    params.fileStorage,
    params.upload,
    params.fileSha256,
  );
  const parsed = toParsedCsvFromRecords(
    headers.length > 0 ? headers : Object.values(params.input.mapping),
    records,
    params.fileSha256,
  );
  const planned = await params.handler.planDryRun(
    {
      ...params.input,
      planBudget: {
        deadlineMs: Number.MAX_SAFE_INTEGER,
        rowNoOffset: rowNos[0],
        rowNumbers: rowNos,
      },
    },
    parsed,
  );
  const unitSet = new Set(rowNos);
  return planned.filter((row) => unitSet.has(row.row_no));
}
