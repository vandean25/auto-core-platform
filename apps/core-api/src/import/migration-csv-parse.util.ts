import { createHash } from 'node:crypto';
import type { MigrationCsvFileName } from './migration-csv-dictionary.js';
import { expectedHeadersForFile } from './migration-csv-dictionary.js';

export type ParsedCanonicalCsv = {
  headers: string[];
  rows: string[][];
  sha256: string;
  rowCount: number;
};

function stripUtf8Bom(buffer: Buffer): Buffer {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
  ) {
    return buffer.subarray(3);
  }
  return buffer;
}

function decodeCanonicalCsvText(buffer: Buffer): string {
  const withoutBom = stripUtf8Bom(buffer);
  const text = withoutBom.toString('utf8');
  if (text.includes('\uFFFD')) {
    throw new Error('INVALID_UTF8');
  }
  return text;
}

/** RFC 4180 comma-separated records; preserves cell text (no trim). */
function parseCommaSeparatedRecords(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (inQuotes) {
      if (char === '"') {
        if (normalized[index + 1] === '"') {
          currentCell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentCell += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      currentRow.push(currentCell);
      currentCell = '';
      continue;
    }
    if (char === '\n') {
      currentRow.push(currentCell);
      if (currentRow.length > 1 || currentRow[0] !== '') {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
      continue;
    }
    currentCell += char;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    if (currentRow.length > 1 || currentRow[0] !== '') {
      rows.push(currentRow);
    }
  }

  return rows;
}

export function sha256Buffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function parseCanonicalMigrationCsv(
  buffer: Buffer,
): ParsedCanonicalCsv {
  const sha256 = sha256Buffer(buffer);
  const text = decodeCanonicalCsvText(buffer);
  if (text.trim().length === 0) {
    return { headers: [], rows: [], sha256, rowCount: 0 };
  }

  const records = parseCommaSeparatedRecords(text);
  if (records.length === 0) {
    return { headers: [], rows: [], sha256, rowCount: 0 };
  }

  const [headers, ...rows] = records;
  return {
    headers,
    rows,
    sha256,
    rowCount: rows.length,
  };
}

export function rowToCanonicalRecord(
  headers: string[],
  cells: string[],
): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((header, index) => {
    record[header] = cells[index] ?? '';
  });
  return record;
}

export function headerOnlyCanonicalCsvBytes(
  fileName: MigrationCsvFileName,
): Buffer {
  const header = `${expectedHeadersForFile(fileName).join(',')}\r\n`;
  return Buffer.from(header, 'utf8');
}
