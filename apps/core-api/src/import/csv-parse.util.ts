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

function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && char === delimiter) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

export function parseCsvFile(buffer: Buffer): ParsedCsv {
  const text = decodeCsvBuffer(buffer)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return {
      headers: [],
      rows: [],
      delimiter: ';',
      sha256: createHash('sha256').update(buffer).digest('hex'),
    };
  }

  const delimiter = detectDelimiter(lines[0]);
  const headers = parseCsvLine(lines[0], delimiter);
  const rows = lines.slice(1).map((line) => parseCsvLine(line, delimiter));

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
    if (
      value.includes(delimiter) ||
      value.includes('"') ||
      value.includes('\n')
    ) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };
  const lines = [
    headers.map(escape).join(delimiter),
    ...rows.map((row) => row.map(escape).join(delimiter)),
  ];
  return `${lines.join('\n')}\n`;
}
