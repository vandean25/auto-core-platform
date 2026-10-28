import { Readable } from 'node:stream';
import type { Prisma } from '@prisma/client';
import type { DisplayLanguage } from '../common/i18n/display-language.js';
import type { ImportFileStorage } from './import-file.storage.js';
import type { ImportJobStore } from './import-job.store.js';
import {
  buildImportErrorReportCsv,
  type ImportErrorReportOptions,
  type ImportJobView,
} from './import-job.serializer.js';
import {
  readUploadRef,
  type ImportJobOptionsWithWorker,
} from './import-job.worker-state.js';
import { openImportSourceRows } from './import-error-report.source.js';

const ERROR_REPORT_PAGE_SIZE = 500;

type ReportSource = Awaited<ReturnType<typeof openImportSourceRows>>;

function missingUpload(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, status } = error as { code?: unknown; status?: unknown };
  return code === 'ENOENT' || code === 404 || code === '404' || status === 404;
}

function normalizedCells(
  row: { normalized_json: Prisma.JsonValue; external_id: string | null },
  options: ImportErrorReportOptions,
): string[] {
  const flattened: Record<string, string> = {};
  const visit = (value: Prisma.JsonValue, prefix = '') => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    for (const [key, cell] of Object.entries(value)) {
      const name = prefix ? `${prefix}_${key}` : key;
      if (cell !== null && typeof cell === 'object') visit(cell, name);
      else flattened[name] = cell === null ? '' : String(cell);
    }
  };
  visit(row.normalized_json);
  flattened.external_id ??= row.external_id ?? '';
  return options.headers.map((header) => {
    const field = Object.keys(options.mapping).find(
      (key) => options.mapping[key] === header.trim(),
    );
    return field ? (flattened[field] ?? '') : '';
  });
}

async function readSourceRow(
  source: ReportSource,
  afterRowNo: number,
  rowNo: number,
): Promise<string[]> {
  let cells: string[] = [];
  for (let current = afterRowNo; current < rowNo; current += 1) {
    const next = await source.rows.next();
    if (next.done) throw new Error('Import source row is unavailable');
    cells = next.value;
  }
  return cells;
}

async function* reportChunks(params: {
  jobStore: ImportJobStore;
  tenantId: string;
  jobId: string;
  options: ImportErrorReportOptions;
  source: ReportSource | null;
}): AsyncGenerator<string> {
  let afterRowNo = 0;
  let sourceRowNo = 0;
  try {
    yield buildImportErrorReportCsv([], params.options);
    for (;;) {
      const rows = await params.jobStore.findErrorRowsAfter({
        tenantId: params.tenantId,
        jobId: params.jobId,
        afterRowNo,
        take: ERROR_REPORT_PAGE_SIZE,
      });
      if (!rows.length) return;
      for (const row of rows) {
        let sourceCells: string[] = [];
        if (params.source) {
          sourceCells = await readSourceRow(
            params.source,
            sourceRowNo,
            row.row_no,
          );
          sourceRowNo = row.row_no;
        } else sourceCells = normalizedCells(row, params.options);
        yield buildImportErrorReportCsv(
          [{ ...row, source_cells: sourceCells }],
          { ...params.options, includeHeader: false },
        );
        afterRowNo = row.row_no;
      }
      if (rows.length < ERROR_REPORT_PAGE_SIZE) return;
    }
  } finally {
    await params.source?.close();
  }
}

export async function createImportErrorReportStream(params: {
  jobStore: ImportJobStore;
  storage: Pick<ImportFileStorage, 'openReadStream'>;
  tenantId: string;
  job: ImportJobView;
  locale: DisplayLanguage;
}): Promise<Readable> {
  const jobOptions = params.job.options_json as ImportJobOptionsWithWorker;
  const upload = readUploadRef(jobOptions);
  let source: ReportSource | null = null;
  if (upload) {
    try {
      source = await openImportSourceRows(
        params.storage.openReadStream(upload) as Readable,
      );
    } catch (error) {
      if (!missingUpload(error)) throw error;
    }
  }
  const mapping = params.job.mapping_json as Record<string, string>;
  const headers = source?.headers ??
    upload?.headers ??
    jobOptions.worker?.csv_headers ?? [...new Set(Object.values(mapping))];
  const report = Readable.from(
    reportChunks({
      jobStore: params.jobStore,
      tenantId: params.tenantId,
      jobId: params.job.id,
      source,
      options: {
        headers,
        mapping,
        locale: params.locale,
        normalizedFallback: !source,
      },
    }),
    { objectMode: false },
  );
  report.once('close', () => {
    void source?.close().catch(() => undefined);
  });
  return report;
}
