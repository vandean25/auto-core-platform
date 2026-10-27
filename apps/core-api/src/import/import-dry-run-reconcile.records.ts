import { rowToRecord, type ParsedCsv } from './csv-parse.util.js';
import { readImportCsvDataRowSlice } from './import-csv-stream.util.js';
import type { ImportFileStorageService } from './import-file.storage.js';
import type { ImportJobUploadRef } from './import-job.worker-state.js';

export type CsvRowRecord = { rowNo: number; record: Record<string, string> };

function contiguousRuns(rowNos: number[]): Array<{ from: number; to: number }> {
  if (rowNos.length === 0) {
    return [];
  }
  const sorted = [...rowNos].sort((a, b) => a - b);
  const runs: Array<{ from: number; to: number }> = [];
  let from = sorted[0];
  let to = sorted[0];
  for (let index = 1; index < sorted.length; index++) {
    const rowNo = sorted[index];
    if (rowNo === to + 1) {
      to = rowNo;
      continue;
    }
    runs.push({ from, to });
    from = rowNo;
    to = rowNo;
  }
  runs.push({ from, to });
  return runs;
}

export function recordFromStoredRow(
  mapping: Record<string, string>,
  externalId: string | null,
  normalized: Record<string, unknown> | null,
): Record<string, string> {
  const record: Record<string, string> = {};
  for (const column of Object.values(mapping)) {
    record[column] = '';
  }
  if (externalId && mapping.external_id) {
    record[mapping.external_id] = externalId;
  }
  if (normalized) {
    for (const [field, column] of Object.entries(mapping)) {
      const value = normalized[field];
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        record[column] = String(value);
      }
    }
  }
  return record;
}

export async function loadCsvRowRecords(
  fileStorage: ImportFileStorageService,
  upload: ImportJobUploadRef,
  fileSha256: string,
  rowNos: number[],
): Promise<CsvRowRecord[]> {
  const runs = contiguousRuns(rowNos);
  const loaded: CsvRowRecord[] = [];
  for (const run of runs) {
    const parsed = await readImportCsvDataRowSlice(
      fileStorage.openReadStream(upload),
      run.from - 1,
      run.to - run.from + 1,
      fileSha256,
    );
    if (!parsed) {
      continue;
    }
    for (let index = 0; index < parsed.rows.length; index++) {
      loaded.push({
        rowNo: run.from + index,
        record: rowToRecord(parsed.headers, parsed.rows[index]),
      });
    }
  }
  return loaded.sort((a, b) => a.rowNo - b.rowNo);
}

export function toParsedCsvFromRecords(
  headers: string[],
  records: CsvRowRecord[],
  fileSha256: string,
): ParsedCsv {
  return {
    headers,
    rows: records.map((row) =>
      headers.map((header) => row.record[header] ?? ''),
    ),
    delimiter: ';',
    sha256: fileSha256,
  };
}
