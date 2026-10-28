import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ParsedCsv } from './csv-parse.util.js';
import {
  CsvIncrementalParser,
  readCsvDataRowSliceFromPull,
  readCsvDataRowSliceFromStream,
  type CsvSliceResume,
} from './csv-incremental.parser.js';
import { createUtf8CsvStreamValidator } from './import-csv-encoding.util.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import { IMPORT_READ_RANGE_BYTES } from './import-file.storage.js';
import type { ImportJobWorkerState } from './import-job.worker-state.js';
import { readImportMaxRowCount } from './import-limits.js';

function nextDataRowCount(dataRowCount: number, maxDataRows: number): number {
  const nextCount = dataRowCount + 1;
  if (nextCount > maxDataRows) {
    throw new BadRequestException({
      code: IMPORT_ERROR_CODES.ROW_LIMIT_EXCEEDED,
      message: `CSV exceeds ${maxDataRows} rows`,
    });
  }
  return nextCount;
}

/** Increments the streaming data-row counter for parser-emitted records (not the header). */
export function applyEmittedCsvRecordCount(
  dataRowCount: number,
  emittedRecordCount: number,
  maxDataRows: number,
): number {
  let count = dataRowCount;
  for (let index = 0; index < emittedRecordCount; index += 1) {
    count = nextDataRowCount(count, maxDataRows);
  }
  return count;
}

export type ImportCsvDataSlice = ParsedCsv & {
  nextByteOffset: number;
  streamBytesRead: number;
  rowByteEnds: number[];
};

export async function readImportCsvDataRowSlice(
  stream: NodeJS.ReadableStream,
  skipDataRows: number,
  takeDataRows: number,
  fileSha256 = '',
  resume?: CsvSliceResume,
): Promise<ImportCsvDataSlice | null> {
  const slice = await readCsvDataRowSliceFromStream(
    stream,
    skipDataRows,
    takeDataRows,
    resume,
  );
  if (!slice) {
    return null;
  }
  return {
    headers: slice.headers,
    rows: slice.rows,
    delimiter: slice.delimiter,
    sha256: fileSha256,
    nextByteOffset: slice.nextByteOffset,
    streamBytesRead: slice.streamBytesRead,
    rowByteEnds: slice.rowByteEnds,
  };
}

export function byteOffsetAfterPersistedRows(
  slice: ImportCsvDataSlice,
  persistedRows: number,
): number {
  if (persistedRows <= 0) {
    return 0;
  }
  if (persistedRows >= slice.rows.length) {
    return slice.nextByteOffset;
  }
  return slice.rowByteEnds[persistedRows - 1] ?? slice.nextByteOffset;
}

export async function readWorkerCsvBatch(
  open: (start: number) => NodeJS.ReadableStream,
  worker: ImportJobWorkerState,
  takeDataRows: number,
  fileSha256: string,
): Promise<ImportCsvDataSlice | null> {
  const byteStart = worker.csv_next_byte ?? 0;
  const ranged =
    byteStart > 0 &&
    worker.csv_headers !== undefined &&
    worker.csv_delimiter !== undefined;
  return readImportCsvDataRowSlice(
    open(ranged ? byteStart : 0),
    ranged ? 0 : worker.processed_rows,
    takeDataRows,
    fileSha256,
    ranged
      ? {
          headers: worker.csv_headers,
          delimiter: worker.csv_delimiter,
          absoluteStart: byteStart,
        }
      : undefined,
  );
}

export async function readWorkerCsvBatchFromRanges(
  readRange: (start: number, end: number) => Promise<Buffer>,
  worker: ImportJobWorkerState,
  takeDataRows: number,
  fileSha256: string,
): Promise<ImportCsvDataSlice | null> {
  const byteStart = worker.csv_next_byte ?? 0;
  const ranged =
    byteStart > 0 &&
    worker.csv_headers !== undefined &&
    worker.csv_delimiter !== undefined;
  let cursor = ranged ? byteStart : 0;
  const slice = await readCsvDataRowSliceFromPull(
    async () => {
      const end = cursor + IMPORT_READ_RANGE_BYTES - 1;
      const bytes = await readRange(cursor, end);
      if (bytes.length === 0) {
        return null;
      }
      cursor += bytes.length;
      return bytes;
    },
    ranged ? 0 : worker.processed_rows,
    takeDataRows,
    ranged
      ? {
          headers: worker.csv_headers,
          delimiter: worker.csv_delimiter,
          absoluteStart: byteStart,
        }
      : undefined,
  );
  if (!slice) {
    return null;
  }
  return {
    headers: slice.headers,
    rows: slice.rows,
    delimiter: slice.delimiter,
    sha256: fileSha256,
    nextByteOffset: slice.nextByteOffset,
    streamBytesRead: slice.streamBytesRead,
    rowByteEnds: slice.rowByteEnds,
  };
}

export async function assessImportCsvFromReadable(
  stream: NodeJS.ReadableStream,
  options?: { maxDataRows?: number },
): Promise<{
  headers: string[];
  delimiter: ';' | ',';
  dataRowCount: number;
  sha256: string;
}> {
  const maxDataRows = options?.maxDataRows ?? readImportMaxRowCount();
  const hash = createHash('sha256');
  const parser = new CsvIncrementalParser();
  const utf8 = createUtf8CsvStreamValidator();
  let dataRowCount = 0;

  for await (const chunk of stream as AsyncIterable<Buffer>) {
    utf8.feed(chunk);
    hash.update(chunk);
    const records = parser.feedChunk(chunk);
    dataRowCount = applyEmittedCsvRecordCount(
      dataRowCount,
      records.length,
      maxDataRows,
    );
  }
  const tailRecords = parser.finish();
  dataRowCount = applyEmittedCsvRecordCount(
    dataRowCount,
    tailRecords.length,
    maxDataRows,
  );
  utf8.finish();

  const headers = parser.getHeaders();
  return {
    headers,
    delimiter: parser.getDelimiter(),
    dataRowCount,
    sha256: hash.digest('hex'),
  };
}
