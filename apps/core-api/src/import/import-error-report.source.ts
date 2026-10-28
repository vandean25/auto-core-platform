import type { Readable } from 'node:stream';
import { csvRecordEnd } from './csv-record-bytes.js';
import {
  decodeCsvBuffer,
  detectDelimiterFromHeaderLine,
  parseCsvRecordsVerbatim,
  unwrapImportErrorReportRow,
} from './csv-parse.util.js';

async function* sourceRecords(stream: Readable): AsyncGenerator<string, void> {
  let pending = Buffer.alloc(0);
  try {
    for await (const chunk of stream) {
      pending = Buffer.concat([pending, Buffer.from(chunk)]);
      let end = csvRecordEnd(pending, 0);
      while (end > 0) {
        yield decodeCsvBuffer(pending.subarray(0, end)).replace(
          /(?:\r\n|\r|\n)$/,
          '',
        );
        pending = pending.subarray(end);
        end = csvRecordEnd(pending, 0);
      }
    }
    if (pending.length)
      yield decodeCsvBuffer(pending).replace(/(?:\r\n|\r|\n)$/, '');
  } finally {
    stream.destroy();
  }
}

export async function openImportSourceRows(stream: Readable): Promise<{
  headers: string[];
  rows: AsyncGenerator<string[]>;
  close: () => Promise<void>;
}> {
  const records = sourceRecords(stream);
  let delimiter: ';' | ',' = ';';
  let headers: string[] = [];
  while (!headers.length) {
    const next = await records.next();
    if (next.done) throw new Error('Import source header is unavailable');
    delimiter = detectDelimiterFromHeaderLine(next.value);
    headers = parseCsvRecordsVerbatim(next.value, delimiter)[0] ?? [];
  }
  const sourceHeaders = unwrapImportErrorReportRow(headers, []).headers;
  const rows = (async function* () {
    try {
      for await (const record of records) {
        const cells = parseCsvRecordsVerbatim(record, delimiter)[0];
        if (cells) yield unwrapImportErrorReportRow(headers, cells).cells;
      }
    } finally {
      await records.return(undefined);
    }
  })();
  return {
    headers: sourceHeaders,
    rows,
    close: async () => {
      stream.destroy();
      await records.return(undefined);
    },
  };
}
