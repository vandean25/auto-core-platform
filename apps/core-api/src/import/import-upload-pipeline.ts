import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { CsvIncrementalParser } from './csv-incremental.parser.js';
import { applyEmittedCsvRecordCount } from './import-csv-stream.util.js';
import { createUtf8CsvStreamValidator } from './import-csv-encoding.util.js';
import { readImportMaxRowCount } from './import-limits.js';
import type {
  ImportFileStorage,
  StoredImportFileRef,
} from './import-file.storage.js';

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
    openSource: () => NodeJS.ReadableStream;
    contentLength?: number;
  },
): Promise<ImportUploadPipeResult> {
  let finished: ImportUploadPipeResult | undefined;
  const ref = await storage.storeUploadFromStream({
    tenantId: params.tenantId,
    jobId: params.jobId,
    fileName: params.fileName,
    openSource: params.openSource,
    contentLength: params.contentLength,
    openThrough: () =>
      inspectTransform((snapshot) => {
        finished = { ref: { object_key: '' }, ...snapshot };
      }),
  });
  if (!finished) {
    throw new Error('Import upload did not finish reading the file');
  }
  return { ...finished, ref };
}

function inspectTransform(
  onFlush: (snapshot: Omit<ImportUploadPipeResult, 'ref'>) => void,
): Transform {
  const hash = createHash('sha256');
  const parser = new CsvIncrementalParser();
  const utf8 = createUtf8CsvStreamValidator();
  let dataRowCount = 0;
  const maxDataRows = readImportMaxRowCount();
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        utf8.feed(chunk);
        hash.update(chunk);
        const records = parser.feedChunk(chunk);
        dataRowCount = applyEmittedCsvRecordCount(
          dataRowCount,
          records.length,
          maxDataRows,
        );
        callback(null, chunk);
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback) {
      try {
        utf8.finish();
        const tailRecords = parser.finish();
        dataRowCount = applyEmittedCsvRecordCount(
          dataRowCount,
          tailRecords.length,
          maxDataRows,
        );
        onFlush({
          sha256: hash.digest('hex'),
          headers: parser.getHeaders(),
          delimiter: parser.getDelimiter(),
          dataRowCount,
        });
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
  });
}
