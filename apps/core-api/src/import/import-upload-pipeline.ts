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
    source: NodeJS.ReadableStream;
  },
): Promise<ImportUploadPipeResult> {
  const hash = createHash('sha256');
  const parser = new CsvIncrementalParser();
  const utf8 = createUtf8CsvStreamValidator();
  let dataRowCount = 0;
  const maxDataRows = readImportMaxRowCount();

  const inspect = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        utf8.feed(chunk);
      } catch (error) {
        callback(error as Error);
        return;
      }
      hash.update(chunk);
      try {
        const records = parser.feedChunk(chunk);
        dataRowCount = applyEmittedCsvRecordCount(
          dataRowCount,
          records.length,
          maxDataRows,
        );
      } catch (error) {
        callback(error as Error);
        return;
      }
      callback(null, chunk);
    },
    flush(callback) {
      try {
        utf8.finish();
      } catch (error) {
        callback(error as Error);
        return;
      }
      try {
        const tailRecords = parser.finish();
        dataRowCount = applyEmittedCsvRecordCount(
          dataRowCount,
          tailRecords.length,
          maxDataRows,
        );
      } catch (error) {
        callback(error as Error);
        return;
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
    headers: parser.getHeaders(),
    delimiter: parser.getDelimiter(),
    dataRowCount,
  };
}
