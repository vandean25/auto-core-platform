import { createHash } from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import { GcsImportFileStorage } from './import-file.storage.js';
import { ImportStorageUnavailableError } from './import-gcs-retry.js';
import {
  byteOffsetAfterPersistedRows,
  readWorkerCsvBatchFromRanges,
} from './import-csv-stream.util.js';
import { pipeImportCsvToStorage } from './import-upload-pipeline.js';
import type { ImportJobWorkerState } from './import-job.worker-state.js';

process.env.IMPORT_GCS_RETRY_BASE_MS = '0';
process.env.IMPORT_UPLOAD_BUCKET = 'import-bucket-test';

class StorageUnderTest extends GcsImportFileStorage {
  constructor(storage: unknown) {
    super();
    this.storage = storage as GcsImportFileStorage['storage'];
  }
}

function resetError(): Error {
  return Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
}

function workerAt(
  processed: number,
  offset: number,
  headers?: string[],
  delimiter?: ';' | ',',
): ImportJobWorkerState {
  return {
    phase: 'dry_run',
    lease_token: 'lease',
    lease_until: new Date(0).toISOString(),
    processed_rows: processed,
    started_at: new Date(0).toISOString(),
    csv_next_byte: offset,
    csv_headers: headers,
    csv_delimiter: delimiter,
  };
}

describe('committed upload 412', () => {
  it('keeps the object when the response is lost and the retry is 412', async () => {
    const content = Buffer.from('h1;h2\n1;2\n3;4\n', 'utf8');
    const jobs: string[] = [];
    let saves = 0;
    const deleteObject = jest.fn(async () => undefined);
    const storage = new StorageUnderTest({
      retryOptions: { autoRetry: true },
      bucket: () => ({
        file: () => ({
          save: jest.fn(async () => {
            saves += 1;
            if (saves === 1) {
              throw resetError();
            }
            throw Object.assign(new Error('precondition'), { code: 412 });
          }),
          delete: deleteObject,
          getMetadata: jest.fn(async () => {
            if (saves < 2) {
              throw Object.assign(new Error('metadata unavailable'), {
                code: 'ECONNRESET',
              });
            }
            return [{
              size: content.length,
              md5Hash: createHash('md5').update(content).digest('base64'),
            }];
          }),
          download: jest.fn(async () => [content]),
        }),
      }),
    });

    const ref = await storage.storeUpload({
      tenantId: 'tenant-a',
      jobId: 'job-412',
      fileName: 'party.csv',
      content,
    });
    jobs.push(ref.object_key);
    expect(saves).toBe(2);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(jobs).toEqual([ref.object_key]);
  });
});

describe('staged upload retry', () => {
  it('rereads the staged file after a mid-stream failure', async () => {
    const lines = ['h1;h2', ...Array.from({ length: 400 }, (_, i) => `${i};x`)];
    const file = Buffer.from(`${lines.join('\n')}\n`, 'utf8');
    let attempt = 0;
    const stored: Buffer[] = [];
    const storage = new StorageUnderTest({
      retryOptions: { autoRetry: true },
      bucket: () => ({
        file: () => ({
          delete: jest.fn(async () => undefined),
          getMetadata: async () => {
            throw Object.assign(new Error('missing'), { code: 404 });
          },
          createWriteStream: () => {
            const stream = new PassThrough();
            const chunks: Buffer[] = [];
            stream.on('data', (chunk: Buffer) => chunks.push(chunk));
            stream.on('finish', () => {
              stored.push(Buffer.concat(chunks));
            });
            return stream;
          },
        }),
      }),
    });

    const piped = await pipeImportCsvToStorage(storage, {
      tenantId: 'tenant-a',
      jobId: 'job-stream',
      fileName: 'party.csv',
      contentLength: file.length,
      openSource: () => {
        attempt += 1;
        if (attempt === 1) {
          return new Readable({
            read() {
              this.push(file.subarray(0, 64));
              this.destroy(resetError());
            },
          });
        }
        return Readable.from([file]);
      },
    });

    expect(attempt).toBe(2);
    expect(stored.at(-1)?.equals(file)).toBe(true);
    expect(piped.sha256).toBe(createHash('sha256').update(file).digest('hex'));
    expect(piped.dataRowCount).toBe(400);
  });
});

describe('persisted-row byte checkpoint', () => {
  it('resumes at the first unpersisted row when planning stops early', async () => {
    const lines = ['h1;h2', ...Array.from({ length: 6 }, (_, i) => `${i + 1};x`)];
    const file = Buffer.from(`${lines.join('\n')}\n`, 'utf8');
    const readRange = async (start: number, end: number) =>
      file.subarray(start, Math.min(file.length, end + 1));
    const collected: string[][] = [];
    let worker = workerAt(0, 0);
    const budget = [2, 6];
    let step = 0;
    while (worker.processed_rows < 6) {
      const slice = await readWorkerCsvBatchFromRanges(
        readRange,
        worker,
        4,
        'sha',
      );
      expect(slice).not.toBeNull();
      const planned = slice!.rows.slice(0, budget[step] ?? slice!.rows.length);
      step += 1;
      collected.push(...planned);
      const nextByte = byteOffsetAfterPersistedRows(slice!, planned.length);
      worker = workerAt(
        worker.processed_rows + planned.length,
        nextByte,
        slice!.headers,
        slice!.delimiter,
      );
      if (step > 4) {
        throw new Error('job stuck');
      }
    }
    expect(collected.map((row) => row[0])).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(worker.processed_rows).toBe(6);
  });
});

describe('short final range', () => {
  it('finishes a 20999-row file on a short batch without reading past EOF', async () => {
    const rowCount = 20_999;
    const batch = 500;
    const body = Array.from({ length: rowCount }, (_, index) => `${index + 1};x`).join('\n');
    const file = Buffer.from(`h1;h2\n${body}\n`, 'utf8');
    let pastEof = 0;
    const readRange = async (start: number, end: number) => {
      if (start >= file.length) {
        pastEof += 1;
        throw Object.assign(new Error('range not satisfiable'), { status: 416 });
      }
      return file.subarray(start, Math.min(file.length, end + 1));
    };
    const collected: string[][] = [];
    let worker = workerAt(0, 0);
    let guard = 0;
    while (worker.processed_rows < rowCount) {
      const slice = await readWorkerCsvBatchFromRanges(readRange, worker, batch, 'sha');
      expect(slice?.rows.length).toBeGreaterThan(0);
      collected.push(...(slice?.rows ?? []));
      worker = workerAt(
        worker.processed_rows + (slice?.rows.length ?? 0),
        slice?.nextByteOffset ?? 0,
        slice?.headers,
        slice?.delimiter,
      );
      guard += 1;
      if (guard > 50) {
        throw new Error('dry-run did not finish');
      }
    }
    expect(collected).toHaveLength(rowCount);
    expect(collected[0]).toEqual(['1', 'x']);
    expect(collected[rowCount - 1]).toEqual([String(rowCount), 'x']);
    expect(pastEof).toBe(0);
    expect(worker.processed_rows).toBe(rowCount);
  });
});

describe('412 confirmation retries', () => {
  function storageFor(save: () => Promise<void>, committed: () => Promise<boolean>, deleteObject: jest.Mock) {
    return new StorageUnderTest({
      retryOptions: { autoRetry: true },
      bucket: () => ({
        file: () => ({
          save,
          delete: deleteObject,
          getMetadata: committed,
          download: async () => [Buffer.alloc(0)],
        }),
      }),
    });
  }

  it('retries a transient confirmation and then accepts the object', async () => {
    const content = Buffer.from('h1;h2\n1;2\n', 'utf8');
    const md5 = createHash('md5').update(content).digest('base64');
    let checks = 0;
    const deleteObject = jest.fn(async () => undefined);
    const storage = storageFor(
      async () => {
        throw Object.assign(new Error('precondition'), { code: 412 });
      },
      async () => {
        checks += 1;
        if (checks === 1) {
          throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
        }
        return [{ size: content.length, md5Hash: md5 }] as unknown as boolean;
      },
      deleteObject,
    );
    const ref = await storage.storeUpload({
      tenantId: 'tenant-a',
      jobId: 'job-confirm',
      fileName: 'party.csv',
      content,
    });
    expect(ref.object_key).toContain('job-confirm');
    expect(deleteObject).not.toHaveBeenCalled();
    expect(checks).toBe(2);
  });

  it('returns storage unavailable when confirmation keeps failing', async () => {
    const content = Buffer.from('h1;h2\n1;2\n', 'utf8');
    const deleteObject = jest.fn(async () => undefined);
    const storage = storageFor(
      async () => {
        throw Object.assign(new Error('precondition'), { code: 412 });
      },
      async () => {
        throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      },
      deleteObject,
    );
    await expect(
      storage.storeUpload({
        tenantId: 'tenant-a',
        jobId: 'job-confirm',
        fileName: 'party.csv',
        content,
      }),
    ).rejects.toBeInstanceOf(ImportStorageUnavailableError);
    expect(deleteObject).not.toHaveBeenCalled();
  });
});
