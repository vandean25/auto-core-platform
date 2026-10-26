import type { ParsedCsv } from './csv-parse.util.js';
import { readCsvDataRowSliceFromStream } from './csv-incremental.parser.js';
import { CsvIncrementalParser } from './csv-incremental.parser.js';
import { createHash } from 'node:crypto';
import { createUtf8CsvStreamValidator } from './import-csv-encoding.util.js';

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
): Promise<{
  headers: string[];
  delimiter: ';' | ',';
  dataRowCount: number;
  sha256: string;
}> {
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
      dataRowCount += 1;
    }
  }
  for (const cells of parser.finish()) {
    if (headers.length === 0) {
      headers = cells;
      continue;
    }
    dataRowCount += 1;
  }
  utf8.finish();

  return {
    headers,
    delimiter: parser.getDelimiter(),
    dataRowCount,
    sha256: hash.digest('hex'),
  };
}
