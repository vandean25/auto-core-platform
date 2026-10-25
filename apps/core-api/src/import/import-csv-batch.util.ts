import { createHash } from 'node:crypto';
import {
  decodeCsvBuffer,
  detectDelimiterFromHeaderLine,
  parseCsvRecords,
  type ParsedCsv,
} from './csv-parse.util.js';

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
