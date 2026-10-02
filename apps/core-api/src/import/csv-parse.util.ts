import { createHash } from 'node:crypto';
import iconv from 'iconv-lite';

export type ParsedCsv = {
  headers: string[];
  rows: string[][];
  delimiter: ';' | ',';
  sha256: string;
};

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function decodeCsvBuffer(buffer: Buffer): string {
  const asUtf8 = stripBom(buffer.toString('utf8'));
  if (!asUtf8.includes('\uFFFD')) {
    return asUtf8;
  }
  return stripBom(iconv.decode(buffer, 'win1252'));
}

function detectDelimiter(headerLine: string): ';' | ',' {
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

function parseCsvRecords(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
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
    if (char === delimiter) {
      currentRow.push(currentCell.trim());
      currentCell = '';
      continue;
    }
    if (char === '\n') {
      currentRow.push(currentCell.trim());
      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
      continue;
    }
    currentCell += char;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((cell) => cell.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
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
  const delimiter = detectDelimiter(headerLine);
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
