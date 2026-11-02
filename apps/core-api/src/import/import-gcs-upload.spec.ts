import { PassThrough, Readable } from 'node:stream';
import { ServiceUnavailableException } from '@nestjs/common';
import { jest as esmJest } from '@jest/globals';

const mockCaptureException = esmJest.fn<(...args: unknown[]) => string>();
esmJest.unstable_mockModule('@sentry/node', () => ({
  captureException: mockCaptureException,
  flush: () => Promise.resolve(true),
}));

const { GlobalExceptionFilter } = await import(
  '../common/filters/global-exception.filter.js'
);
import { GcsImportFileStorage } from './import-file.storage.js';
import {
  ImportStorageUnavailableError,
  importStorageUnavailableException,
} from './import-gcs-retry.js';
import {
  readCsvDataRowSliceFromStream,
} from './csv-incremental.parser.js';
import { readWorkerCsvBatch } from './import-csv-stream.util.js';
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

describe('GCS import upload retry', () => {
  it('saves with ifGenerationMatch 0 and leaves autoRetry on', async () => {
    const save = jest.fn(async () => undefined);
    const retryOptions = { autoRetry: true };
    const storage = new StorageUnderTest({
      retryOptions,
      bucket: () => ({
        file: () => ({
          save,
          delete: jest.fn(),
          getMetadata: async () => {
            throw Object.assign(new Error('missing'), { code: 404 });
          },
          download: async () => [Buffer.alloc(0)],
        }),
      }),
    });
    await storage.storeUpload({
      tenantId: 'tenant-a',
      jobId: 'job-b',
      fileName: 'party.csv',
      content: Buffer.from('a;b\n1;2\n'),
    });
    expect(save).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        preconditionOpts: { ifGenerationMatch: 0 },
        resumable: false,
      }),
    );
    expect(retryOptions.autoRetry).toBe(true);
  });

  it('retries a reset twice and then stores the upload', async () => {
    let calls = 0;
    const save = jest.fn(async () => {
      calls += 1;
      if (calls < 3) {
        throw resetError();
      }
    });
    const deleteObject = jest.fn(async () => undefined);
    const storage = new StorageUnderTest({
      retryOptions: { autoRetry: true },
      bucket: () => ({
        file: () => ({
          save,
          delete: deleteObject,
          getMetadata: async () => {
            throw Object.assign(new Error('missing'), { code: 404 });
          },
          download: async () => [Buffer.alloc(0)],
        }),
      }),
    });
    const ref = await storage.storeUpload({
      tenantId: 'tenant-a',
      jobId: 'job-b',
      fileName: 'party.csv',
      content: Buffer.from('a;b\n1;2\n'),
    });
    expect(ref.object_key).toContain('job-b');
    expect(save).toHaveBeenCalledTimes(3);
    expect(deleteObject).toHaveBeenCalledTimes(2);
  });

  it('returns 503 IMPORT_STORAGE_UNAVAILABLE and reports it once', async () => {
    const save = jest.fn(async () => {
      throw new Error('permanent bucket failure');
    });
    const deleteObject = jest.fn(async () => undefined);
    const jobs: string[] = [];
    const storage = new StorageUnderTest({
      retryOptions: { autoRetry: true },
      bucket: () => ({
        file: () => ({
          save,
          delete: deleteObject,
          getMetadata: async () => {
            throw Object.assign(new Error('missing'), { code: 404 });
          },
          download: async () => [Buffer.alloc(0)],
        }),
      }),
    });
    let thrown: unknown;
    try {
      await storage.storeUpload({
        tenantId: 'tenant-a',
        jobId: 'job-left',
        fileName: 'party.csv',
        content: Buffer.from('a;b\n'),
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ImportStorageUnavailableError);
    expect(deleteObject).toHaveBeenCalled();
    expect(jobs).toEqual([]);
    const http = importStorageUnavailableException(
      thrown as ImportStorageUnavailableError,
    );
    expect(http).toBeInstanceOf(ServiceUnavailableException);
    expect(http.getStatus()).toBe(503);
    const previousDsn = process.env.SENTRY_DSN;
    process.env.SENTRY_DSN = 'https://public@sentry.example/1';
    mockCaptureException.mockReturnValue('evt-1');
    const json = jest.fn();
    const filter = new GlobalExceptionFilter();
    jest.spyOn((filter as unknown as { logger: { error: () => void } }).logger, 'error').mockImplementation(() => undefined);
    filter.catch(http, {
      switchToHttp: () => ({
        getResponse: () => ({
          status: () => ({ json }),
          getHeader: () => undefined,
          setHeader: jest.fn(),
          headersSent: false,
        }),
        getRequest: () => ({ headers: { 'x-request-id': 'req-764' }, params: {} }),
      }),
    } as never);
    await new Promise((resolve) => setImmediate(resolve));
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 503,
        code: 'IMPORT_STORAGE_UNAVAILABLE',
        requestId: 'req-764',
      }),
    );
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledWith(
      http,
      expect.objectContaining({
        tags: { requestId: 'req-764', jobId: 'job-left' },
      }),
    );
    if (previousDsn === undefined) {
      delete process.env.SENTRY_DSN;
    } else {
      process.env.SENTRY_DSN = previousDsn;
    }
  });
});

describe('CSV byte-offset batches', () => {
  const file = Buffer.from('h1;h2\n"a\nb";1\ncafé;2\nplain;3\n', 'utf8');

  async function parseAll(bytes: Buffer) {
    return readCsvDataRowSliceFromStream(Readable.from([bytes]), 0, 20);
  }

  it('resumes at the next record, including quotes and a split code point', async () => {
    const whole = await parseAll(file);
    const cafeAt = file.indexOf(Buffer.from('café', 'utf8'));
    const chunks = [
      file.subarray(0, cafeAt + 1),
      file.subarray(cafeAt + 1),
    ];
    const split = await readCsvDataRowSliceFromStream(Readable.from(chunks), 0, 20);
    expect(split?.rows).toEqual(whole?.rows);
    const first = await readCsvDataRowSliceFromStream(Readable.from([file]), 0, 1);
    const tail = file.subarray(first?.nextByteOffset ?? 0);
    const second = await readCsvDataRowSliceFromStream(
      Readable.from([tail]),
      0,
      20,
      {
        headers: first?.headers,
        delimiter: first?.delimiter,
        absoluteStart: first?.nextByteOffset,
      },
    );
    expect([...(first?.rows ?? []), ...(second?.rows ?? [])]).toEqual(whole?.rows);
    expect(second?.streamBytesRead).toBe(tail.length);
    expect(tail.length).toBeLessThan(file.length);
  });

  it('opens one ranged stream per batch and destroys it', async () => {
    const first = await readCsvDataRowSliceFromStream(Readable.from([file]), 0, 1);
    let destroyed = 0;
    let opened = 0;
    const worker = {
      phase: 'dry_run',
      lease_token: 'lease',
      lease_until: new Date(0).toISOString(),
      processed_rows: 1,
      started_at: new Date(0).toISOString(),
      csv_next_byte: first?.nextByteOffset,
      csv_headers: first?.headers,
      csv_delimiter: first?.delimiter,
    } satisfies ImportJobWorkerState;
    const open = (start: number) => {
      opened += 1;
      expect(start).toBe(first?.nextByteOffset);
      const stream = Readable.from([file.subarray(start)]);
      const destroy = stream.destroy.bind(stream);
      stream.destroy = ((error?: Error) => {
        destroyed += 1;
        return destroy(error);
      });
      return stream;
    };
    const batch = await readWorkerCsvBatch(open, worker, 2, 'sha');
    expect(opened).toBe(1);
    expect(destroyed).toBeGreaterThan(0);
    expect(batch?.rows).toEqual([
      ['café', '2'],
      ['plain', '3'],
    ]);
    expect(batch?.streamBytesRead).toBeLessThan(file.length);
  });

  it('returns parallel upload emitters to the baseline listener count', async () => {
    const warnings: Error[] = [];
    const onWarning = (warning: Error) => {
      if (warning.name === 'MaxListenersExceededWarning') {
        warnings.push(warning);
      }
    };
    process.on('warning', onWarning);
    const shared = new PassThrough();
    const baseline = shared.listenerCount('error');
    const opened: PassThrough[] = [];
    const storage = new StorageUnderTest({
      retryOptions: { autoRetry: true },
      bucket: () => ({
        file: () => ({
          delete: jest.fn(async () => undefined),
          createWriteStream: () => {
            const stream = new PassThrough();
            stream.on('error', () => undefined);
            opened.push(stream);
            return stream;
          },
        }),
      }),
    });
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        storage.storeUploadFromStream({
          tenantId: 'tenant-a',
          jobId: `job-${index}`,
          fileName: 'party.csv',
          openSource: () => Readable.from([Buffer.from('a;b\n1;2\n')]),
        }),
      ),
    );
    await new Promise((resolve) => setImmediate(resolve));
    for (const stream of opened) {
      expect(stream.listenerCount('error')).toBe(0);
    }
    shared.removeAllListeners();
    expect(shared.listenerCount('error')).toBe(baseline);
    expect(warnings).toEqual([]);
    process.off('warning', onWarning);
  });
});
