import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ParsedCsv } from './csv-parse.util.js';
import {
  CsvIncrementalParser,
  readCsvDataRowSliceFromStream,
} from './csv-incremental.parser.js';
import { createUtf8CsvStreamValidator } from './import-csv-encoding.util.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import { readImportMaxRowCount } from './import-limits.js';

function assertStreamingRowWithinLimit(
  dataRowCount: number,
  maxDataRows: number,
): void {
  if (dataRowCount > maxDataRows) {
    throw new BadRequestException({
      code: IMPORT_ERROR_CODES.ROW_LIMIT_EXCEEDED,
      message: `CSV exceeds ${maxDataRows} rows`,
    });
  }
}

function countParsedDataRow(
  headers: string[],
  dataRowCount: number,
  maxDataRows: number,
): { headers: string[]; dataRowCount: number } {
  if (headers.length === 0) {
    return { headers: cells, dataRowCount };
  }
  const nextCount = dataRowCount + 1;
  assertStreamingRowWithinLimit(nextCount, maxDataRows);
  return { headers, dataRowCount: nextCount };
}

export async function readImportCsvDataRowSlice(
  stream: NodeJS.ReadableStream,
  skipDataRows: number,
  takeDataRows: number,
  fileSha256 = '',
): Promise<ParsedCsv | null> {
  const slice = await readCsvDataRowSliceFromStream(
    stream,
    skipDataRows,
    takeDataRows,
  );
  if (!slice) {
    return null;
  }
  return {
    headers: slice.headers,
    rows: slice.rows,
    delimiter: slice.delimiter,
    sha256: fileSha256,
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
  let headers: string[] = [];
  let dataRowCount = 0;

  for await (const chunk of stream as AsyncIterable<Buffer>) {
    utf8.feed(chunk);
    hash.update(chunk);
    for (const cells of parser.feedChunk(chunk)) {
      if (headers.length === 0) {
        headers = cells;
        continue;
      }
      ({ dataRowCount } = countParsedDataRow(
        headers,
        dataRowCount,
        maxDataRows,
      ));
    }
  }
  for (const cells of parser.finish()) {
    if (headers.length === 0) {
      headers = cells;
      continue;
    }
    ({ dataRowCount } = countParsedDataRow(
      headers,
      dataRowCount,
      maxDataRows,
    ));
  }
  utf8.finish();

  return {
    headers,
    delimiter: parser.getDelimiter(),
    dataRowCount,
    sha256: hash.digest('hex'),
  };
}
