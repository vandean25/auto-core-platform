import { createReadStream } from 'node:fs';
import type { ParsedCsv } from './csv-parse.util.js';
import { readCsvDataRowSliceFromStream } from './csv-incremental.parser.js';
import { assertTrustedImportStagingPath } from './import-file.storage.js';
import { CsvIncrementalParser } from './csv-incremental.parser.js';
import { createHash } from 'node:crypto';

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
  let headers: string[] = [];
  let dataRowCount = 0;

  for await (const chunk of stream as AsyncIterable<Buffer>) {
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

  return {
    headers,
    delimiter: parser.getDelimiter(),
    dataRowCount,
    sha256: hash.digest('hex'),
  };
}

export async function assessImportCsvFromStagingPath(stagingPath: string) {
  const trusted = assertTrustedImportStagingPath(stagingPath);
  return assessImportCsvFromReadable(createReadStream(trusted));
}
