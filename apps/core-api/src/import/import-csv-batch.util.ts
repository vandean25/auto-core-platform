import { createHash } from 'node:crypto';
import {
  decodeCsvBuffer,
  detectDelimiterFromHeaderLine,
} from './csv-parse.util.js';

type CsvRowWalkState = {
  rows: string[][];
  currentRow: string[];
  currentCell: string;
  inQuotes: boolean;
};

function pushWalkRow(state: CsvRowWalkState): void {
  state.currentRow.push(state.currentCell.trim());
  if (state.currentRow.some((cell) => cell.length > 0)) {
    state.rows.push(state.currentRow);
  }
  state.currentRow = [];
  state.currentCell = '';
}

function walkCsvChar(
  state: CsvRowWalkState,
  text: string,
  index: number,
  delimiter: string,
): number {
  const char = text[index];
  if (state.inQuotes) {
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
  if (char === '"') {
    state.inQuotes = true;
    return index;
  }
  if (char === delimiter) {
    state.currentRow.push(state.currentCell.trim());
    state.currentCell = '';
    return index;
  }
  if (char === '\n') {
    pushWalkRow(state);
    return index;
  }
  state.currentCell += char;
  return index;
}

function forEachCsvRecord(
  text: string,
  delimiter: string,
  onRecord: (cells: string[], recordIndex: number) => 'stop' | void,
): number {
  const state: CsvRowWalkState = {
    rows: [],
    currentRow: [],
    currentCell: '',
    inQuotes: false,
  };
  let recordIndex = 0;
  for (let index = 0; index < text.length; index += 1) {
    index = walkCsvChar(state, text, index, delimiter);
    if (state.rows.length > 0) {
      const row = state.rows.pop()!;
      const result = onRecord(row, recordIndex);
      recordIndex += 1;
      if (result === 'stop') {
        return recordIndex;
      }
    }
  }
  if (state.currentCell.length > 0 || state.currentRow.length > 0) {
    pushWalkRow(state);
    if (state.rows.length > 0) {
      onRecord(state.rows[0], recordIndex);
      recordIndex += 1;
    }
  }
  return recordIndex;
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
  let headers: string[] = [];
  let dataRowCount = 0;
  forEachCsvRecord(text, delimiter, (cells, index) => {
    if (index === 0) {
      headers = cells;
      return;
    }
    dataRowCount += 1;
  });
  if (headers.length === 0) {
    return { headers: [], delimiter, dataRowCount: 0, sha256 };
  }
  return { headers, delimiter, dataRowCount, sha256 };
}

