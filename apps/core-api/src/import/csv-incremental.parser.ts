import { StringDecoder } from 'node:string_decoder';
import {
  detectDelimiterFromHeaderLine,
  stripBomFromText,
} from './csv-parse.util.js';

type CsvRowWalkState = {
  currentRow: string[];
  currentCell: string;
  inQuotes: boolean;
};

function pushWalkRow(state: CsvRowWalkState, out: string[][]): void {
  state.currentRow.push(state.currentCell.trim());
  if (state.currentRow.some((cell) => cell.length > 0)) {
    out.push(state.currentRow);
  }
  state.currentRow = [];
  state.currentCell = '';
}

function walkCsvChar(
  state: CsvRowWalkState,
  out: string[][],
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
    pushWalkRow(state, out);
    return index;
  }
  state.currentCell += char;
  return index;
}

/** Incremental CSV parser over UTF-8 byte chunks (no whole-file string). */
export class CsvIncrementalParser {
  private readonly decoder = new StringDecoder('utf8');
  private readonly walkState: CsvRowWalkState = {
    currentRow: [],
    currentCell: '',
    inQuotes: false,
  };
  private delimiter: ';' | ',' | null = null;
  private headerLineRaw = '';
  private headers: string[] | null = null;

  feedChunk(chunk: Buffer): string[][] {
    const text = this.decoder
      .write(chunk)
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');
    return this.consumeText(text);
  }

  finish(): string[][] {
    const tail = this.decoder.end().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const rows = tail.length > 0 ? this.consumeText(tail) : [];
    if (
      this.walkState.currentCell.length > 0 ||
      this.walkState.currentRow.length > 0
    ) {
      pushWalkRow(this.walkState, rows);
    }
    return rows;
  }

  getHeaders(): string[] {
    return this.headers ?? [];
  }

  getDelimiter(): ';' | ',' {
    return this.delimiter ?? ';';
  }

  private consumeText(text: string): string[][] {
    const completed: string[][] = [];
    if (this.delimiter === null) {
      for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (char === '\n') {
          this.headerLineRaw += text.slice(0, index);
          this.headerLineRaw = stripBomFromText(this.headerLineRaw);
          this.delimiter = detectDelimiterFromHeaderLine(this.headerLineRaw);
          const headerCells: string[][] = [];
          const headerState: CsvRowWalkState = {
            currentRow: [],
            currentCell: '',
            inQuotes: false,
          };
          for (let hi = 0; hi < this.headerLineRaw.length; hi += 1) {
            hi = walkCsvChar(
              headerState,
              headerCells,
              this.headerLineRaw,
              hi,
              this.delimiter,
            );
          }
          pushWalkRow(headerState, headerCells);
          this.headers = headerCells[0] ?? [];
          const rest = text.slice(index + 1);
          if (rest.length > 0) {
            completed.push(...this.consumeWithDelimiter(rest));
          }
          return completed;
        }
      }
      this.headerLineRaw += text;
      return completed;
    }
    return this.consumeWithDelimiter(text);
  }

  private consumeWithDelimiter(text: string): string[][] {
    const delimiter = this.delimiter ?? ';';
    const completed: string[][] = [];
    for (let index = 0; index < text.length; index += 1) {
      index = walkCsvChar(this.walkState, completed, text, index, delimiter);
    }
    return completed;
  }
}

export type CsvStreamSliceResult = {
  headers: string[];
  delimiter: ';' | ',';
  rows: string[][];
};

/** Reads a batch of data rows from a stream without loading the whole file. */
export async function readCsvDataRowSliceFromStream(
  stream: NodeJS.ReadableStream,
  skipDataRows: number,
  takeDataRows: number,
): Promise<CsvStreamSliceResult | null> {
  const parser = new CsvIncrementalParser();
  const rows: string[][] = [];
  let dataRowsSeen = 0;

  const collect = (records: string[][]): 'stop' | void => {
    for (const cells of records) {
      if (dataRowsSeen < skipDataRows) {
        dataRowsSeen += 1;
        continue;
      }
      if (rows.length >= takeDataRows) {
        return 'stop';
      }
      rows.push(cells);
      dataRowsSeen += 1;
    }
  };

  for await (const chunk of stream as AsyncIterable<Buffer>) {
    const stop = collect(parser.feedChunk(chunk));
    if (stop === 'stop') {
      const destroyable = stream as unknown as { destroy?: () => void };
      if (typeof destroyable.destroy === 'function') {
        destroyable.destroy();
      }
      break;
    }
  }
  if (rows.length < takeDataRows) {
    collect(parser.finish());
  }

  const headers = parser.getHeaders();
  if (headers.length === 0) {
    return null;
  }
  return {
    headers,
    delimiter: parser.getDelimiter(),
    rows,
  };
}
