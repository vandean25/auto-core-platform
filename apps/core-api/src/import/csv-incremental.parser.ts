import { StringDecoder } from 'node:string_decoder';
import { csvRecordEnd } from './csv-record-bytes.js';
import {
  detectDelimiterFromHeaderLine,
  stripBomFromText,
} from './csv-parse.util.js';
import { createUtf8CsvStreamValidator } from './import-csv-encoding.util.js';

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

  /** Continues at a data-row byte offset. Header and delimiter come from worker state. */
  resume(headers: string[], delimiter: ';' | ','): void {
    this.headers = headers;
    this.delimiter = delimiter;
    this.headerLineRaw = headers.join(delimiter);
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
  nextByteOffset: number;
  streamBytesRead: number;
};

export type CsvSliceResume = {
  headers?: string[];
  delimiter?: ';' | ',';
  absoluteStart?: number;
};

type SliceCollect = {
  parser: CsvIncrementalParser;
  rows: string[][];
  skipped: number;
  collected: number;
  skipDataRows: number;
  takeDataRows: number;
  pending: Buffer;
  absolute: number;
  streamBytesRead: number;
  headerDone: boolean;
};

function releaseReadable(stream: NodeJS.ReadableStream): void {
  const emitter = stream as NodeJS.EventEmitter & { destroy?: () => void };
  const swallow = () => undefined;
  emitter.on?.('error', swallow);
  emitter.destroy?.();
  setImmediate(() => {
    emitter.removeAllListeners?.();
  });
}

function takeRecords(state: SliceCollect): boolean {
  let end = csvRecordEnd(state.pending, 0);
  while (end > 0) {
    const record = state.pending.subarray(0, end);
    state.pending = state.pending.subarray(end);
    state.absolute += end;
    end = csvRecordEnd(state.pending, 0);
    if (!state.headerDone) {
      state.parser.feedChunk(record);
      state.headerDone = true;
      continue;
    }
    const parsed = state.parser.feedChunk(record);
    if (state.skipped < state.skipDataRows) {
      state.skipped += parsed.length > 0 ? 1 : 0;
      continue;
    }
    if (parsed.length === 0 || state.collected >= state.takeDataRows) {
      continue;
    }
    state.rows.push(parsed[0]);
    state.collected += 1;
    if (state.collected >= state.takeDataRows) {
      return true;
    }
  }
  return false;
}

function finishTail(state: SliceCollect): void {
  if (state.pending.length === 0 || state.collected >= state.takeDataRows) {
    return;
  }
  const record = state.pending;
  state.pending = Buffer.alloc(0);
  state.absolute += record.length;
  if (!state.headerDone) {
    state.parser.feedChunk(record);
    state.parser.finish();
    return;
  }
  const parsed = [...state.parser.feedChunk(record), ...state.parser.finish()];
  if (state.skipped < state.skipDataRows || parsed.length === 0) {
    return;
  }
  state.rows.push(parsed[0]);
}

/** Reads one batch. A resume offset skips bytes the caller already stored. */
export async function readCsvDataRowSliceFromStream(
  stream: NodeJS.ReadableStream,
  skipDataRows: number,
  takeDataRows: number,
  resume?: CsvSliceResume,
): Promise<CsvStreamSliceResult | null> {
  const parser = new CsvIncrementalParser();
  const utf8 = createUtf8CsvStreamValidator();
  const headerDone = Boolean(resume?.headers && resume.delimiter);
  if (resume?.headers && resume.delimiter) {
    parser.resume(resume.headers, resume.delimiter);
  }
  const state: SliceCollect = {
    parser,
    rows: [],
    skipped: 0,
    collected: 0,
    skipDataRows,
    takeDataRows,
    pending: Buffer.alloc(0),
    absolute: resume?.absoluteStart ?? 0,
    streamBytesRead: 0,
    headerDone,
  };
  const onError = () => undefined;
  (stream as NodeJS.EventEmitter).once?.('error', onError);
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      utf8.feed(bytes);
      state.streamBytesRead += bytes.length;
      state.pending = Buffer.concat([state.pending, bytes]);
      if (takeRecords(state)) {
        break;
      }
    }
    if (state.collected < takeDataRows) {
      finishTail(state);
    }
    utf8.finish();
    const headers = parser.getHeaders();
    if (headers.length === 0) {
      return null;
    }
    return {
      headers,
      delimiter: parser.getDelimiter(),
      rows: state.rows,
      nextByteOffset: state.absolute,
      streamBytesRead: state.streamBytesRead,
    };
  } finally {
    (stream as NodeJS.EventEmitter).off?.('error', onError);
    releaseReadable(stream);
  }
}
