import {
  rowToRecord,
  unwrapImportErrorReportRow,
  type ParsedCsv,
} from './csv-parse.util.js';
import { readCsvSliceByRange } from './import-csv-stream.util.js';
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

export async function loadCsvRowRecords(
  fileStorage: ImportFileStorageService,
  upload: ImportJobUploadRef,
  fileSha256: string,
  rowNos: number[],
): Promise<CsvRowRecord[]> {
  const runs = contiguousRuns(rowNos);
  const loaded: CsvRowRecord[] = [];
  for (const run of runs) {
    const parsed = await readCsvSliceByRange(
      (start, end) => fileStorage.readByteRange(upload, start, end),
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
  const sourceHeaders = unwrapImportErrorReportRow(headers, []).headers;
  return {
    headers: sourceHeaders,
    rows: records.map((row) =>
      sourceHeaders.map((header) => row.record[header] ?? ''),
    ),
    delimiter: ';',
    sha256: fileSha256,
  };
}
