import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ParsedCsv } from './csv-parse.util.js';
import { parseCsvBufferDataRowSlice } from './import-csv-batch.util.js';

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Reads a slice of data rows from stored import CSV without retaining earlier rows.
 * shortcut: loads the object into one buffer per tick; upgrade to a true byte stream parser if files grow past ~100 MiB.
 */
export async function readImportCsvDataRowSlice(
  stream: NodeJS.ReadableStream,
  skipDataRows: number,
  takeDataRows: number,
): Promise<ParsedCsv | null> {
  const buffer = await streamToBuffer(stream);
  return parseCsvBufferDataRowSlice(buffer, skipDataRows, takeDataRows);
}

export function bufferImportCsvStream(
  stream: NodeJS.ReadableStream,
): Promise<{ buffer: Buffer; sha256: string }> {
  const hash = createHash('sha256');
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(buf);
      chunks.push(buf);
    });
    stream.on('error', reject);
    stream.on('end', () => {
      resolve({ buffer: Buffer.concat(chunks), sha256: hash.digest('hex') });
    });
  });
}

export function toReadableStream(buffer: Buffer): NodeJS.ReadableStream {
  return Readable.from(buffer);
}
