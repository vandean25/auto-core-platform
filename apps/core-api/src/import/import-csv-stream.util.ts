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
  let dataRowCount = 0;

  for await (const chunk of stream as AsyncIterable<Buffer>) {
    utf8.feed(chunk);
    hash.update(chunk);
    const records = parser.feedChunk(chunk);
    for (let index = 0; index < records.length; index += 1) {
      dataRowCount = nextDataRowCount(dataRowCount, maxDataRows);
    }
  }
  const tailRecords = parser.finish();
  for (let index = 0; index < tailRecords.length; index += 1) {
    dataRowCount = nextDataRowCount(dataRowCount, maxDataRows);
  }
  utf8.finish();

  const headers = parser.getHeaders();
  return {
    headers,
    delimiter: parser.getDelimiter(),
    dataRowCount,
    sha256: hash.digest('hex'),
  };
}
