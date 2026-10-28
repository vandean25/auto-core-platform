import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
} from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { parseCsvFile, serializeCsv } from '../src/import/csv-parse.util.js';
import {
  ImportFileStorageService,
  type StoredImportFileRef,
} from '../src/import/import-file.storage.js';
import { ImportJobStore } from '../src/import/import-job.store.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

const headers = [
  'Source ID',
  'Given name',
  'Family name',
  'Original description',
];
const mapping = {
  external_id: 'Source ID',
  first_name: 'Given name',
  last_name: 'Family name',
};
const sourceSystem = 'synthetic';

describe('localized streamed import error report (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: ImportFileStorageService;
  let tenant: TestTenantResult;
  let otherTenant: TestTenantResult;
  let salesTenant: TestTenantResult;
  let auth: string;
  let otherAuth: string;
  let salesAuth: string;
  const uploads: StoredImportFileRef[] = [];
  const previousStorage = process.env.IMPORT_UPLOAD_STORAGE;

  beforeAll(async () => {
    process.env.IMPORT_UPLOAD_STORAGE = 'local';
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();
    prisma = app.get(PrismaService);
    storage = app.get(ImportFileStorageService);
    tenant = await createTestTenant(prisma, 'report-admin');
    otherTenant = await createTestTenant(prisma, 'report-other');
    salesTenant = await createTestTenant(prisma, 'report-sales');
    await runWithTenantContext(salesTenant.tenantId, () =>
      prisma.tenantMember.updateMany({
        where: { tenant_id: salesTenant.tenantId },
        data: { role: 'SALES' },
      }),
    );
    const authService = app.get(AuthService);
    auth = `Bearer ${createTestAuthToken(authService, tenant)}`;
    otherAuth = `Bearer ${createTestAuthToken(authService, otherTenant)}`;
    salesAuth = `Bearer ${createTestAuthToken(authService, { ...salesTenant, role: 'SALES' })}`;
  });

  afterAll(async () => {
    await Promise.all(uploads.map((upload) => storage.deleteUpload(upload)));
    await cleanupTestTenantGraph(prisma, tenant.tenantId);
    await cleanupTestTenantGraph(prisma, otherTenant.tenantId);
    await cleanupTestTenantGraph(prisma, salesTenant.tenantId);
    await teardownTestApp(app, prisma);
    if (previousStorage === undefined) delete process.env.IMPORT_UPLOAD_STORAGE;
    else process.env.IMPORT_UPLOAD_STORAGE = previousStorage;
  });

  async function upload(csv: string) {
    const response = await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', auth)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', sourceSystem)
      .field('mapping', JSON.stringify(mapping))
      .attach('file', Buffer.from(csv), 'synthetic-source.csv')
      .expect(201);
    const job = await runWithTenantContext(tenant.tenantId, () =>
      prisma.importJob.findFirst({
        where: { tenant_id: tenant.tenantId, id: response.body.id },
      }),
    );
    const options = job!.options_json as { upload: StoredImportFileRef };
    uploads.push(options.upload);
    return response.body as {
      id: string;
      totals: { error: number; create: number };
    };
  }

  it('exports three original bad rows in DE and EN and reimports their fixed values with the same mapping', async () => {
    const job = await upload(
      serializeCsv(headers, [
        ['', 'Sample', 'One', 'keep;this'],
        ['', 'Sample', 'Two', 'keep "quotes"'],
        ['', 'Sample', 'Three', 'keep\nnewlines'],
      ]),
    );
    expect(job.totals.error).toBe(3);
    const german = await request(app.getHttpServer())
      .get(`/imports/${job.id}/errors.csv`)
      .set('Authorization', auth)
      .set('Accept-Language', 'de-AT')
      .expect(200);
    const english = await request(app.getHttpServer())
      .get(`/imports/${job.id}/errors.csv`)
      .set('Authorization', auth)
      .set('Accept-Language', 'en-US')
      .expect(200);
    expect(german.headers['content-type']).toMatch(/text\/csv.*utf-8/);
    expect(german.headers['cache-control']).toBe('private, no-store');
    expect(german.text.charCodeAt(0)).toBe(0xfeff);
    const parsed = parseCsvFile(Buffer.from(german.text));
    expect(parsed.headers).toEqual([
      'row_no',
      ...headers,
      'error_field',
      'error_message',
      'error_code',
    ]);
    expect(parsed.rows.map((row) => row.slice(0, 5))).toEqual([
      ['1', '', 'Sample', 'One', 'keep;this'],
      ['2', '', 'Sample', 'Two', 'keep "quotes"'],
      ['3', '', 'Sample', 'Three', 'keep\nnewlines'],
    ]);
    expect(german.text).toContain(
      'Die externe Nummer fehlt. Bitte ergänzen Sie die Nummer in dieser Zeile.',
    );
    expect(english.text).toContain(
      'The external ID is missing. Enter an ID for this row.',
    );
    parsed.rows.forEach((row, index) => {
      row[1] = `FIXED-${index + 1}`;
    });
    const fixed = await upload(serializeCsv(parsed.headers, parsed.rows));
    expect(fixed.totals).toMatchObject({ error: 0, create: 3 });
    await request(app.getHttpServer())
      .get(`/imports/${job.id}/errors.csv`)
      .set('Authorization', otherAuth)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/imports/${job.id}/errors.csv`)
      .set('Authorization', salesAuth)
      .expect(403);
  });

  it('reads a 50,000-row synthetic error job in bounded pages through HTTP', async () => {
    const total = 50_000;
    const job = await runWithTenantContext(tenant.tenantId, () =>
      prisma.importJob.create({
        data: {
          tenant_id: tenant.tenantId,
          entity_type: ImportEntityType.CUSTOMER,
          source_system: sourceSystem,
          file_name: 'synthetic-large.csv',
          file_sha256: 'synthetic-sha',
          status: ImportJobStatus.DRY_RUN_DONE,
          mapping_json: mapping,
          options_json: {},
          totals_json: {
            rows: total,
            create: 0,
            update: 0,
            skip: 0,
            error: total,
          },
        },
      }),
    );
    await runWithTenantContext(tenant.tenantId, () =>
      Promise.all(
        Array.from({ length: 50 }, (_, page) =>
          prisma.importJobRow.createMany({
            data: Array.from({ length: 1000 }, (_, index) => ({
              tenant_id: tenant.tenantId,
              import_job_id: job.id,
              row_no: page * 1000 + index + 1,
              action: ImportRowAction.ERROR,
              errors_json: [
                {
                  code: 'IMPORT_APPLY_FAILED',
                  message: 'Row failed during apply',
                },
              ],
              normalized_json: {
                external_id: `SOURCE-${page * 1000 + index + 1}`,
                first_name: 'Sample',
                last_name: 'Row',
              },
            })),
          }),
        ),
      ),
    );
    const spy = jest.spyOn(ImportJobStore.prototype, 'findErrorRowsAfter');
    try {
      const response = await request(app.getHttpServer())
        .get(`/imports/${job.id}/errors.csv`)
        .set('Authorization', auth)
        .set('Accept-Language', 'en')
        .expect(200);
      expect(parseCsvFile(Buffer.from(response.text)).rows).toHaveLength(total);
      expect(spy.mock.calls.length).toBeGreaterThan(50);
      expect(
        spy.mock.calls.every(
          ([params]) =>
            params.take <= 1000 &&
            params.tenantId === tenant.tenantId &&
            params.jobId === job.id,
        ),
      ).toBe(true);
      expect(response.text).toContain(
        'This row could not be imported. Try importing it again.',
      );
    } finally {
      spy.mockRestore();
    }
  });
});
