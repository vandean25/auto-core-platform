import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { Storage } from '@google-cloud/storage';
import { PassThroughClient } from 'google-auth-library';
import { GcsImportFileStorage } from './import-file.storage.js';
import { readWorkerCsvBatchFromRanges } from './import-csv-stream.util.js';
import type { ImportJobWorkerState } from './import-job.worker-state.js';

process.env.IMPORT_UPLOAD_BUCKET = 'import-bucket-test';
process.env.IMPORT_GCS_RETRY_BASE_MS = '0';

class StorageUnderTest extends GcsImportFileStorage {
  constructor(storage: Storage) {
    super();
    this.storage = storage;
  }
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });
}

function watchWarnings(): { warnings: Error[]; stop: () => void } {
  const warnings: Error[] = [];
  const onWarning = (warning: Error) => {
    if (warning.name === 'MaxListenersExceededWarning') {
      warnings.push(warning);
    }
  };
  process.on('warning', onWarning);
  return {
    warnings,
    stop: () => process.off('warning', onWarning),
  };
}

describe('real storage client media reads', () => {
  let server: Server;
  let storage: StorageUnderTest;
  const objects = new Map<string, Buffer>();

  beforeAll(async () => {
    server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const marker = '/o/';
      const index = url.pathname.indexOf(marker);
      const named = url.searchParams.get('name');
      const objectName =
        index >= 0
          ? decodeURIComponent(url.pathname.slice(index + marker.length))
          : named
            ? decodeURIComponent(named)
            : '';
      if (request.method === 'GET' && objectName && url.searchParams.get('alt') !== 'media') {
        const body = objects.get(objectName);
        if (!body) {
          response.writeHead(404);
          response.end();
          return;
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            size: String(body.length),
            md5Hash: createHash('md5').update(body).digest('base64'),
          }),
        );
        return;
      }
      if (request.method === 'GET' && objectName) {
        const body = objects.get(objectName);
        if (!body) {
          response.writeHead(404);
          response.end();
          return;
        }
        const match = /^bytes=(\d+)-(\d*)$/.exec(String(request.headers.range ?? ''));
        if (!match) {
          response.writeHead(200);
          response.end(body);
          return;
        }
        const start = Number(match[1]);
        if (start >= body.length) {
          response.writeHead(416);
          response.end();
          return;
        }
        const end = match[2] ? Number(match[2]) : body.length - 1;
        const slice = body.subarray(start, Math.min(body.length, end + 1));
        response.writeHead(206);
        response.end(slice);
        return;
      }
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        const content = Buffer.from('h1;h2\n1;2\n', 'utf8');
        if (objectName) {
          objects.set(objectName, content);
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            name: objectName,
            size: String(content.length),
            md5Hash: createHash('md5').update(content).digest('base64'),
          }),
        );
      });
    });
    const port = await listen(server);
    storage = new StorageUnderTest(
      new Storage({
        apiEndpoint: `http://127.0.0.1:${port}`,
        projectId: 'local',
        authClient: new PassThroughClient(),
      }),
    );
  }, 15000);

  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  it('reads N ranges through the real client without MaxListenersExceededWarning', async () => {
    const file = Buffer.from(
      `h1;h2\n${Array.from({ length: 40 }, (_, index) => `${index};x`).join('\n')}\n`,
      'utf8',
    );
    objects.set('tenants/tenant-a/imports/job-b/party.csv', file);
    const seen = watchWarnings();
    const batches = await Promise.all(
      Array.from({ length: 12 }, () =>
        readWorkerCsvBatchFromRanges(
          (start, end) =>
            storage.readByteRange(
              { object_key: 'tenants/tenant-a/imports/job-b/party.csv' },
              start,
              end,
            ),
          {
            phase: 'dry_run',
            lease_token: 'lease',
            lease_until: new Date(0).toISOString(),
            processed_rows: 0,
            started_at: new Date(0).toISOString(),
          } satisfies ImportJobWorkerState,
          10,
          'sha',
        ),
      ),
    );
    seen.stop();
    expect(batches.every((batch) => (batch?.rows.length ?? 0) > 0)).toBe(true);
    expect(seen.warnings).toEqual([]);
  });

  it('uploads N files through the real client without MaxListenersExceededWarning', async () => {
    const seen = watchWarnings();
    const content = Buffer.from('h1;h2\n1;2\n', 'utf8');
    await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        storage.storeUpload({
          tenantId: 'tenant-a',
          jobId: `job-${index}`,
          fileName: 'party.csv',
          content,
        }),
      ),
    );
    seen.stop();
    expect(seen.warnings).toEqual([]);
  }, 12000);
});
