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
  recordFromStoredRow,
  toParsedCsvFromRecords,
  type CsvRowRecord,
} from './import-dry-run-reconcile.records.js';
import { shouldStopDryRunPlanningAfterRow } from './import-dry-run-plan-budget.js';
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

async function loadContextRecords(
  prisma: PrismaService,
  params: {
    tenantId: string;
    jobId: string;
    mapping: Record<string, string>;
    unit: ImportDryRunReconcileUnit;
    targets: number[];
    fileStorage: ImportFileStorageService;
    upload: ImportJobUploadRef;
    fileSha256: string;
  },
): Promise<CsvRowRecord[]> {
  const maxTarget = Math.max(...params.targets);
  const contextRowNos = [
    ...new Set(
      params.unit.replan_row_nos.filter((rowNo) => rowNo <= maxTarget),
    ),
  ].sort((a, b) => a - b);
  const csvRows = await loadCsvRowRecords(
    params.fileStorage,
    params.upload,
    params.fileSha256,
    contextRowNos,
  );
  const csvByRow = new Map(csvRows.map((row) => [row.rowNo, row.record]));

  const stored = await prisma.importJobRow.findMany({
    where: {
      tenant_id: params.tenantId,
      import_job_id: params.jobId,
      row_no: { in: contextRowNos },
    },
    select: {
      row_no: true,
      external_id: true,
      normalized_json: true,
    },
    orderBy: { row_no: 'asc' },
  });
  const storedByRow = new Map(
    stored.map((row) => [
      row.row_no,
      recordFromStoredRow(
        params.mapping,
        row.external_id,
        row.normalized_json as Record<string, unknown> | null,
      ),
    ]),
  );

  const records: CsvRowRecord[] = [];
  for (const rowNo of contextRowNos) {
    const fromCsv = csvByRow.get(rowNo);
    if (fromCsv) {
      records.push({ rowNo, record: fromCsv });
      continue;
    }
    const fromDb = storedByRow.get(rowNo);
    if (fromDb) {
      records.push({ rowNo, record: fromDb });
    }
  }
  return records;
}

export async function replanImportDryRunUnitChunk(params: {
  prisma: PrismaService;
  fileStorage: ImportFileStorageService;
  upload: ImportJobUploadRef;
  fileSha256: string;
  tenantId: string;
  jobId: string;
  handler: ImportTypeHandler;
  input: ImportDryRunInput;
  unit: ImportDryRunReconcileUnit;
  targetStartIndex: number;
  batchSize: number;
  deadlineMs: number;
}): Promise<{ rows: DryRunRowResult[]; nextTargetIndex: number }> {
  const { unit, targetStartIndex, batchSize, deadlineMs } = params;
  const targets: number[] = [];
  let index = targetStartIndex;
  while (
    index < unit.replan_row_nos.length &&
    targets.length < batchSize &&
    !shouldStopDryRunPlanningAfterRow(
      { deadlineMs, rowNoOffset: 1 },
      targets.length,
    )
  ) {
    targets.push(unit.replan_row_nos[index]);
    index += 1;
  }
  if (targets.length === 0) {
    return { rows: [], nextTargetIndex: index };
  }

  const combined = await loadContextRecords(params.prisma, {
    tenantId: params.tenantId,
    jobId: params.jobId,
    mapping: params.input.mapping,
    unit,
    targets,
    fileStorage: params.fileStorage,
    upload: params.upload,
    fileSha256: params.fileSha256,
  });
  if (combined.length === 0) {
    return { rows: [], nextTargetIndex: index };
  }

  const headers = await loadFileHeaders(
    params.fileStorage,
    params.upload,
    params.fileSha256,
  );
  const parsed = toParsedCsvFromRecords(
    headers.length > 0 ? headers : Object.values(params.input.mapping),
    combined,
    params.fileSha256,
  );
  const planned = await params.handler.planDryRun(
    {
      ...params.input,
      planBudget: {
        deadlineMs,
        rowNoOffset: combined[0].rowNo,
        rowNumbers: combined.map((row) => row.rowNo),
      },
    },
    parsed,
  );

  const targetSet = new Set(targets);
  const rows = planned.filter((row) => targetSet.has(row.row_no));
  return { rows, nextTargetIndex: index };
}
