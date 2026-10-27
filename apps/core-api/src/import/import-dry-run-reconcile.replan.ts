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
import { loadReconcilePriorDryRunResults } from './import-dry-run-reconcile.prior.js';
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

export function pickReconcileTargets(
  unit: ImportDryRunReconcileUnit,
  targetStartIndex: number,
  batchSize: number,
  deadlineMs: number,
): { targets: number[]; selectionEndIndex: number } {
  const targets: number[] = [];
  let selectionEndIndex = targetStartIndex;
  while (
    selectionEndIndex < unit.replan_row_nos.length &&
    targets.length < batchSize &&
    !shouldStopDryRunPlanningAfterRow(
      { deadlineMs, rowNoOffset: 1 },
      targets.length,
    )
  ) {
    targets.push(unit.replan_row_nos[selectionEndIndex]);
    selectionEndIndex += 1;
  }
  return { targets, selectionEndIndex };
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
  const { targets, selectionEndIndex } = pickReconcileTargets(
    unit,
    targetStartIndex,
    batchSize,
    deadlineMs,
  );
  if (targets.length === 0) {
    return { rows: [], nextTargetIndex: selectionEndIndex };
  }

  const priorRowNos = unit.replan_row_nos.slice(0, targetStartIndex);
  const reconcilePriorResults = await loadReconcilePriorDryRunResults(
    params.prisma,
    params.tenantId,
    params.jobId,
    priorRowNos,
  );

  const targetRecords = await loadCsvRowRecords(
    params.fileStorage,
    params.upload,
    params.fileSha256,
    targets,
  );
  if (targetRecords.length === 0) {
    return { rows: [], nextTargetIndex: targetStartIndex };
  }

  const headers = await loadFileHeaders(
    params.fileStorage,
    params.upload,
    params.fileSha256,
  );
  const parsed = toParsedCsvFromRecords(
    headers.length > 0 ? headers : Object.values(params.input.mapping),
    targetRecords,
    params.fileSha256,
  );
  const planned = await params.handler.planDryRun(
    {
      ...params.input,
      reconcilePriorResults,
      planBudget: {
        deadlineMs,
        rowNoOffset: targets[0],
        rowNumbers: targets,
      },
    },
    parsed,
  );

  const nextTargetIndex = computeReconcileTargetCursor(
    unit,
    targetStartIndex,
    selectionEndIndex,
    planned,
  );
  if (nextTargetIndex === targetStartIndex) {
    return { rows: [], nextTargetIndex: targetStartIndex };
  }

  const unitRowSet = new Set(unit.replan_row_nos);
  const rows = planned.filter((row) => unitRowSet.has(row.row_no));

  return { rows, nextTargetIndex };
}

export function computeReconcileTargetCursor(
  unit: ImportDryRunReconcileUnit,
  targetStartIndex: number,
  selectionEndIndex: number,
  planned: DryRunRowResult[],
): number {
  const plannedRowNos = new Set(planned.map((row) => row.row_no));
  let nextTargetIndex = targetStartIndex;
  for (let cursor = targetStartIndex; cursor < selectionEndIndex; cursor += 1) {
    const rowNo = unit.replan_row_nos[cursor];
    if (!plannedRowNos.has(rowNo)) {
      break;
    }
    nextTargetIndex = cursor + 1;
  }
  return nextTargetIndex;
}
