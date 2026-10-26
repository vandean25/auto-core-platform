import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CsvIncrementalParser } from './csv-incremental.parser.js';
import type { ImportFileStorage, StoredImportFileRef } from './import-file.storage.js';

export type ImportUploadPipeResult = {
  ref: StoredImportFileRef;
  sha256: string;
  headers: string[];
  delimiter: ';' | ',';
  dataRowCount: number;
};

/** One streaming pass: hash, count rows, and persist to import storage. */
export async function pipeImportCsvToStorage(
  storage: Pick<ImportFileStorage, 'storeUploadFromStream'>,
  params: {
    tenantId: string;
    jobId: string;
    fileName: string;
    source: NodeJS.ReadableStream;
  },
): Promise<ImportUploadPipeResult> {
  const hash = createHash('sha256');
  const parser = new CsvIncrementalParser();
  let headers: string[] = [];
  let dataRowCount = 0;

  const inspect = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      const records = parser.feedChunk(chunk);
      for (const cells of records) {
        if (headers.length === 0) {
          headers = cells;
          continue;
        }
        dataRowCount += 1;
      }
      callback(null, chunk);
    },
    flush(callback) {
      for (const cells of parser.finish()) {
        if (headers.length === 0) {
          headers = cells;
          continue;
        }
        dataRowCount += 1;
      }
      callback();
    },
  });

  const ref = await storage.storeUploadFromStream({
    tenantId: params.tenantId,
    jobId: params.jobId,
    fileName: params.fileName,
    source: params.source,
    through: inspect,
  });

  return {
    ref,
    sha256: hash.digest('hex'),
    headers,
    delimiter: parser.getDelimiter(),
    dataRowCount,
  };
}

export async function pipeReadableThroughStorage(
  storage: Pick<ImportFileStorage, 'storeUploadFromStream'>,
  params: {
    tenantId: string;
    jobId: string;
    fileName: string;
    source: NodeJS.ReadableStream;
  },
  through: Transform,
): Promise<StoredImportFileRef> {
  return storage.storeUploadFromStream({
    ...params,
    through,
  });
}
