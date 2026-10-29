import { ImportJobStatus } from '@prisma/client';
import type { ImportEntityType, ImportRowAction, Prisma } from '@prisma/client';
import { sanitizeCsvInjectionValue } from './csv-parse.util.js';
import { getImportReportCopy } from './import-error-report.i18n.js';
import type { DisplayLanguage } from '../common/i18n/display-language.js';
import type { ImportJobTotals } from './import.types.js';
import { isStaleApplyingImportJob } from './import-apply-lease.js';
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
  updatedAt?: Date | null;
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
  const stalled = isStaleApplyingImportJob(job, Date.now());
  const publicOptions = { ...rawOptions };
  delete publicOptions.worker;
  delete publicOptions.upload;
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
    stalled,
    recovery_hint: stalled
      ? 'Job is stalled. Re-apply it (POST apply) to resume.'
      : null,
    created_by: job.created_by,
    created_at: job.createdAt.toISOString(),
    applied_at: job.appliedAt?.toISOString() ?? null,
  };
}

export type SerializedImportJob = ReturnType<typeof serializeImportJob>;

export type ImportJobListItemView = {
  id: string;
  entity_type: ImportEntityType;
  source_system: string;
  file_name: string;
  status: ImportJobStatus;
  options_json: Prisma.JsonValue;
  totals_json: Prisma.JsonValue;
  created_by: string | null;
  createdAt: Date;
  appliedAt: Date | null;
};

/**
 * List-row shape for the import history. Deliberately omits mapping, options
 * and per-row payloads so the list never carries raw CSV data or PII.
 */
export function serializeImportJobListItem(job: ImportJobListItemView) {
  const totals = (job.totals_json ?? {}) as Partial<ImportJobTotals>;
  const options = (job.options_json ?? {}) as { apply_failure_code?: string };
  const failureCode =
    job.status === ImportJobStatus.FAILED
      ? options.apply_failure_code
      : undefined;
  return {
    id: job.id,
    status: job.status,
    entity_type: job.entity_type,
    source_system: job.source_system,
    file_name: job.file_name,
    totals: {
      create: totals.create ?? 0,
      update: totals.update ?? 0,
      skip: totals.skip ?? 0,
      error: totals.error ?? 0,
    },
    created_by: job.created_by,
    created_at: job.createdAt.toISOString(),
    applied_at: job.appliedAt?.toISOString() ?? null,
    ...(failureCode ? { apply_failure_code: failureCode } : {}),
  };
}

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

export type ImportErrorReportRow = Pick<
  ImportJobRowView,
  'row_no' | 'errors_json'
> & {
  source_cells: string[];
};

export type ImportErrorReportOptions = {
  headers: string[];
  mapping: Record<string, string>;
  locale: DisplayLanguage;
  includeHeader?: boolean;
  normalizedFallback?: boolean;
};

function escapeReportCell(value: string): string {
  const safe = value.startsWith("'")
    ? `'${value}`
    : sanitizeCsvInjectionValue(value);
  return /[;,"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function reportIssueCells(
  row: ImportErrorReportRow,
  options: ImportErrorReportOptions,
): string[] {
  const copy = getImportReportCopy(options.locale);
  const issues = Array.isArray(row.errors_json)
    ? row.errors_json.filter(
        (issue): issue is Prisma.JsonObject =>
          typeof issue === 'object' && issue !== null && !Array.isArray(issue),
      )
    : [];
  const fields = issues
    .map((issue) => {
      const field = typeof issue.field === 'string' ? issue.field : '';
      const mapped = options.mapping[field];
      return (
        options.headers.find((header) => header.trim() === mapped) ??
        mapped ??
        ''
      );
    })
    .filter(Boolean);
  const codes = issues.map((issue) =>
    typeof issue.code === 'string' ? issue.code : '',
  );
  const messages = codes.map((code) =>
    typeof copy.codes[code] === 'string' ? copy.codes[code] : copy.unknownError,
  );
  return [
    fields.join(' | '),
    messages.length ? messages.join(' | ') : copy.unknownError,
    codes.join(' | '),
  ];
}

export function buildImportErrorReportCsv(
  rows: ImportErrorReportRow[],
  options: ImportErrorReportOptions,
): string {
  const headers = [
    'row_no',
    ...options.headers,
    'error_field',
    'error_message',
    'error_code',
    ...(options.normalizedFallback ? ['note'] : []),
  ];
  const lines =
    options.includeHeader === false
      ? []
      : [headers.map(escapeReportCell).join(';')];
  for (const row of rows) {
    const cells = [
      String(row.row_no),
      ...options.headers.map((_, index) => row.source_cells[index] ?? ''),
      ...reportIssueCells(row, options),
    ];
    if (options.normalizedFallback)
      cells.push(getImportReportCopy(options.locale).normalizedFallback);
    lines.push(cells.map(escapeReportCell).join(';'));
  }
  return `${options.includeHeader === false ? '' : '\uFEFF'}${lines.join('\r\n')}${lines.length ? '\r\n' : ''}`;
}
