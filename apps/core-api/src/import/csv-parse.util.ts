import { createHash } from 'node:crypto';
import iconv from 'iconv-lite';
import { csvRecordEnd } from './csv-record-bytes.js';

export type ParsedCsv = {
  headers: string[];
  rows: string[][];
  delimiter: ';' | ',';
  sha256: string;
};

export function stripBomFromText(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function stripBom(text: string): string {
  return stripBomFromText(text);
}

export function decodeCsvBuffer(buffer: Buffer): string {
  const asUtf8 = stripBom(buffer.toString('utf8'));
  if (!asUtf8.includes('\uFFFD')) {
    return asUtf8;
  }
  return stripBom(iconv.decode(buffer, 'win1252'));
}

export function detectDelimiterFromHeaderLine(headerLine: string): ';' | ',' {
  let semicolons = 0;
  let commas = 0;
  let inQuotes = false;
  for (let index = 0; index < headerLine.length; index += 1) {
    const char = headerLine[index];
    if (char === '"') {
      if (inQuotes && headerLine[index + 1] === '"') index += 1;
      else inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (char === ';') semicolons += 1;
      else if (char === ',') commas += 1;
    }
  }
  return semicolons >= commas ? ';' : ',';
}

/** Neutralises spreadsheet formula injection (OWASP CSV guidance). */
export function sanitizeCsvInjectionValue(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

type CsvRecordParseState = {
  rows: string[][];
  currentRow: string[];
  currentCell: string;
  inQuotes: boolean;
};

function pushCsvRow(state: CsvRecordParseState): void {
  state.currentRow.push(state.currentCell);
  if (state.currentRow.some((cell) => cell.trim().length > 0)) {
    state.rows.push(state.currentRow);
  }
  state.currentRow = [];
  state.currentCell = '';
}

function consumeQuotedCsvChar(
  state: CsvRecordParseState,
  text: string,
  index: number,
): number {
  const char = text[index];
  if (char !== '"') {
    state.currentCell += char;
    return index;
  }
  if (text[index + 1] === '"') {
    state.currentCell += '"';
    return index + 1;
  }
  state.inQuotes = false;
  return index;
}

function consumeUnquotedCsvChar(
  state: CsvRecordParseState,
  char: string,
  delimiter: string,
): void {
  if (char === '"') {
    state.inQuotes = true;
    return;
  }
  if (char === delimiter) {
    state.currentRow.push(state.currentCell);
    state.currentCell = '';
    return;
  }
  if (char === '\n') {
    pushCsvRow(state);
    return;
  }
  state.currentCell += char;
}

export function parseCsvRecords(text: string, delimiter: string): string[][] {
  return parseCsvRecordsVerbatim(text, delimiter).map((row) =>
    row.map((cell) => cell.trim()),
  );
}

export function parseCsvRecordsVerbatim(
  text: string,
  delimiter: string,
): string[][] {
  const state: CsvRecordParseState = {
    rows: [],
    currentRow: [],
    currentCell: '',
    inQuotes: false,
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (state.inQuotes) {
      index = consumeQuotedCsvChar(state, text, index);
      continue;
    }
    consumeUnquotedCsvChar(state, char, delimiter);
  }

  if (state.currentCell.length > 0 || state.currentRow.length > 0) {
    pushCsvRow(state);
  }

  return state.rows;
}

export function parseCsvFile(buffer: Buffer): ParsedCsv {
  const text = decodeCsvBuffer(buffer)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  if (text.trim().length === 0) {
    return {
      headers: [],
      rows: [],
      delimiter: ';',
      sha256: createHash('sha256').update(buffer).digest('hex'),
    };
  }

  const headerEnd = csvRecordEnd(buffer, 0);
  const headerRecord = decodeCsvBuffer(
    headerEnd < 0 ? buffer : buffer.subarray(0, headerEnd),
  );
  const delimiter = detectDelimiterFromHeaderLine(headerRecord);
  const records = parseCsvRecords(text, delimiter);

  if (records.length === 0) {
    return {
      headers: [],
      rows: [],
      delimiter,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    };
  }

  const [headers, ...rows] = records;

  return {
    headers,
    rows,
    delimiter,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };
}

export function unwrapImportErrorReportRow(
  headers: string[],
  cells: string[],
): { headers: string[]; cells: string[] } {
  const diagnosticStart = headers.length - (headers.at(-1) === 'note' ? 4 : 3);
  const isErrorReport =
    headers[0] === 'row_no' &&
    headers.slice(diagnosticStart, diagnosticStart + 3).join(';') ===
      'error_field;error_message;error_code';
  if (!isErrorReport) return { headers, cells };
  const restore = (value: string) => value.replace(/^'(?=['=+\-@\t\r])/, '');
  return {
    headers: headers.slice(1, diagnosticStart).map(restore),
    cells: cells.slice(1, diagnosticStart).map(restore),
  };
}

export function rowToRecord(
  headers: string[],
  cells: string[],
): Record<string, string> {
  const source = unwrapImportErrorReportRow(headers, cells);
  const record: Record<string, string> = {};
  source.headers.forEach((header, index) => {
    record[header] = source.cells[index] ?? '';
  });
  return record;
}

export function serializeCsv(
  headers: string[],
  rows: string[][],
  delimiter: ';' | ',' = ';',
): string {
  const escape = (value: string) => {
    const safe = sanitizeCsvInjectionValue(value);
    if (safe.includes(delimiter) || safe.includes('"') || safe.includes('\n')) {
      return `"${safe.replace(/"/g, '""')}"`;
    }
    return safe;
  };
  const lines = [
    headers.map(escape).join(delimiter),
    ...rows.map((row) => row.map(escape).join(delimiter)),
  ];
  return `${lines.join('\n')}\n`;
}
