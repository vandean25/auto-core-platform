import { createHash } from 'node:crypto';
import iconv from 'iconv-lite';

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
  const semicolons = (headerLine.match(/;/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
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
  state.currentRow.push(state.currentCell.trim());
  if (state.currentRow.some((cell) => cell.length > 0)) {
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
    state.currentRow.push(state.currentCell.trim());
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

  const firstLineEnd = text.indexOf('\n');
  const headerLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd);
  const delimiter = detectDelimiterFromHeaderLine(headerLine);
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

export function rowToRecord(
  headers: string[],
  cells: string[],
): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((header, index) => {
    record[header] = cells[index] ?? '';
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
