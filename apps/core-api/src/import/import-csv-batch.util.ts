import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import {
  decodeCsvBuffer,
  detectDelimiterFromHeaderLine,
  parseCsvRecords,
  type ParsedCsv,
} from './csv-parse.util.js';

export type CsvBatch = {
  rowOffset: number;
  rows: string[][];
};

/** Streams a stored CSV and yields fixed-size data-row batches without loading all rows. */
export async function* iterateCsvRowBatches(params: {
  stream: Readable;
  batchSize: number;
}): AsyncGenerator<{
  headers: string[];
  delimiter: ';' | ',';
  batch: CsvBatch;
}> {
  const lines: string[] = [];
  const rl = createInterface({ input: params.stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim().length > 0) {
      lines.push(line);
    }
  }
  if (lines.length === 0) {
    return;
  }
  const delimiter = detectDelimiterFromHeaderLine(lines[0]);
  const records = parseCsvRecords(lines.join('\n'), delimiter);
  if (records.length === 0) {
    return;
  }
  const [headers, ...dataRows] = records;
  for (let offset = 0; offset < dataRows.length; offset += params.batchSize) {
    yield {
      headers,
      delimiter,
      batch: {
        rowOffset: offset,
        rows: dataRows.slice(offset, offset + params.batchSize),
      },
    };
  }
}

export function countCsvDataRows(buffer: Buffer): number {
  const parsed = parseCsvBufferHeadersOnly(buffer);
  return parsed.dataRowCount;
}

export function parseCsvBufferHeadersOnly(buffer: Buffer): {
  headers: string[];
  delimiter: ';' | ',';
  dataRowCount: number;
  sha256: string;
} {
  const text = decodeCsvBuffer(buffer)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  if (text.trim().length === 0) {
    return { headers: [], delimiter: ';', dataRowCount: 0, sha256 };
  }
  const firstLineEnd = text.indexOf('\n');
  const headerLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd);
  const delimiter = detectDelimiterFromHeaderLine(headerLine);
  const records = parseCsvRecords(text, delimiter);
  if (records.length === 0) {
    return { headers: [], delimiter, dataRowCount: 0, sha256 };
  }
  const [headers, ...rows] = records;
  return { headers, delimiter, dataRowCount: rows.length, sha256 };
}

export function sliceParsedCsv(
  parsed: ParsedCsv,
  rowOffset: number,
  rows: string[][],
): ParsedCsv {
  return {
    headers: parsed.headers,
    rows,
    delimiter: parsed.delimiter,
    sha256: parsed.sha256,
  };
}
