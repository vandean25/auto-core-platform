import type {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import { serializeCsv } from './csv-parse.util.js';
import type { ImportJobTotals } from './import.types.js';
import {
  computeImportProgress,
  type ImportJobOptionsWithWorker,
} from './import-job.worker-state.js';

export type ImportJobView = {
  id: string;
  entity_type: ImportEntityType;
  source_system: string;
  file_name: string;
  file_sha256: string;
  status: ImportJobStatus;
  mapping_json: Prisma.JsonValue;
  options_json: Prisma.JsonValue;
  totals_json: Prisma.JsonValue;
  created_by: string | null;
  createdAt: Date;
  appliedAt: Date | null;
};

export function serializeImportJob(
  job: ImportJobView,
  totals: ImportJobTotals,
) {
  const rawOptions = (job.options_json ?? {}) as ImportJobOptionsWithWorker;
  const progress = computeImportProgress({
    status: job.status,
    totals,
    options: rawOptions,
  });
  const { worker: _worker, upload: _upload, ...publicOptions } = rawOptions;
  return {
    id: job.id,
    entity_type: job.entity_type,
    source_system: job.source_system,
    file_name: job.file_name,
    file_sha256: job.file_sha256,
    status: job.status,
    mapping: job.mapping_json,
    options: publicOptions,
    totals,
    progress,
    created_by: job.created_by,
    created_at: job.createdAt.toISOString(),
    applied_at: job.appliedAt?.toISOString() ?? null,
  };
}

export type SerializedImportJob = ReturnType<typeof serializeImportJob>;

/** Response shaping for an applied job. The facade supplies it so runners report through it. */
export type SerializeImportJobFn = (
  job: ImportJobView,
  totals: ImportJobTotals,
) => SerializedImportJob;

export type ImportJobRowView = {
  row_no: number;
  external_id: string | null;
  action: ImportRowAction;
  entity_id: string | null;
  errors_json: Prisma.JsonValue;
  warnings_json: Prisma.JsonValue;
  normalized_json: Prisma.JsonValue;
};

export function serializeImportRow(row: ImportJobRowView) {
  return {
    row_no: row.row_no,
    external_id: row.external_id,
    action: row.action,
    entity_id: row.entity_id,
    errors: row.errors_json ?? [],
    warnings: row.warnings_json ?? [],
    normalized: row.normalized_json,
  };
}

const ERROR_REPORT_HEADERS = ['row_no', 'external_id', 'errors'];

/** Semicolon CSV of the rows that failed, with their errors as JSON. */
export function buildImportErrorReportCsv(
  rows: Array<Pick<ImportJobRowView, 'row_no' | 'external_id' | 'errors_json'>>,
): string {
  const data = rows.map((row) => [
    String(row.row_no),
    row.external_id ?? '',
    JSON.stringify(row.errors_json ?? []),
  ]);
  return serializeCsv(ERROR_REPORT_HEADERS, data, ';');
}
