import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { CsvIncrementalParser } from './csv-incremental.parser.js';
import { createUtf8CsvStreamValidator } from './import-csv-encoding.util.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';
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

  const countDataRow = (): void => {
    dataRowCount += 1;
    if (dataRowCount > maxDataRows) {
      throw new BadRequestException({
        code: IMPORT_ERROR_CODES.ROW_LIMIT_EXCEEDED,
        message: `CSV exceeds ${maxDataRows} rows`,
      });
    }
  };

  const inspect = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        utf8.feed(chunk);
      } catch (error) {
        callback(error as Error);
        return;
      }
      hash.update(chunk);
      const records = parser.feedChunk(chunk);
      for (let index = 0; index < records.length; index += 1) {
        countDataRow();
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
        for (let index = 0; index < tailRecords.length; index += 1) {
          countDataRow();
        }
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
