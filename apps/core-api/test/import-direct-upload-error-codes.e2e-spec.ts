import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { IMPORT_ERROR_CODES } from '../src/import/import.constants.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createE2eApp } from './helpers/e2e-suite.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

const MAX_BYTES = 4096;
const SOURCE_KEY = 'legacy-codes';
const UNKNOWN_UPLOAD_ID = '00000000-0000-4000-8000-000000000000';

/**
 * The four direct-upload gates as a client sees them. The global filter replaces a code that is not in
 * CLIENT_SAFE_HTTP_ERROR_CODES with the status fallback, so these only hold while the codes stay allowlisted.
 */
describe('Direct import upload error codes (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let tenant: Awaited<ReturnType<typeof createTestTenant>>;
  let adminHeader: string;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of [
      'IMPORT_UPLOAD_STORAGE',
      'IMPORT_UPLOAD_BUCKET',
      'IMPORT_DIRECT_UPLOAD_MAX_FILE_BYTES',
      'CLOUD_TASKS_ENABLED',
    ]) {
      saved[key] = process.env[key];
    }
    process.env.IMPORT_UPLOAD_STORAGE = 'local';
    process.env.IMPORT_UPLOAD_BUCKET = 'direct-upload-error-codes-e2e';
    process.env.IMPORT_DIRECT_UPLOAD_MAX_FILE_BYTES = String(MAX_BYTES);
    process.env.CLOUD_TASKS_ENABLED = 'false';

    app = await createE2eApp(undefined, { productionErrorFilter: true });
    basePrisma = app.get(PrismaService);
    tenant = await createTestTenant(basePrisma, 'import-upload-codes');
    await createTenantAwarePrisma(basePrisma, tenant.tenantId).importSource.create(
      {
        data: {
          tenant_id: tenant.tenantId,
          key: SOURCE_KEY,
          label: 'Codes Source',
        },
      },
    );
    adminHeader = `Bearer ${createTestAuthToken(app.get(AuthService), tenant)}`;
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await cleanupTestTenantGraph(basePrisma, tenant.tenantId);
    await teardownTestApp(app, basePrisma);
  });

  function startUpload(payload: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/api/imports/direct-uploads')
      .set('Authorization', adminHeader)
      .send(payload);
  }

  function finalizeUpload(uploadId: string) {
    return request(app.getHttpServer())
      .post(`/api/imports/direct-uploads/${uploadId}/finalize`)
      .set('Authorization', adminHeader)
      .send({
        fileName: 'report.csv',
        size: 100,
        entityType: 'CUSTOMER',
        sourceSystem: SOURCE_KEY,
        mapping: { external_id: 'Kunden-Nr' },
        options: {},
      });
  }

  it('reports its own code when the declared size is above the cap', async () => {
    const response = await startUpload({
      fileName: 'report.csv',
      size: MAX_BYTES + 1,
    }).expect(413);

    expect(response.body.code).toBe(IMPORT_ERROR_CODES.DIRECT_UPLOAD_TOO_LARGE);
  });

  it('reports its own code when the declared content type is not a CSV type', async () => {
    const response = await startUpload({
      fileName: 'report.csv',
      size: 100,
      contentType: 'application/pdf',
    }).expect(400);

    expect(response.body.code).toBe(
      IMPORT_ERROR_CODES.DIRECT_UPLOAD_CONTENT_TYPE,
    );
  });

  it('reports its own code when the file name is not a CSV name', async () => {
    const response = await startUpload({
      fileName: 'report.xlsx',
      size: 100,
    }).expect(400);

    expect(response.body.code).toBe(IMPORT_ERROR_CODES.DIRECT_UPLOAD_INVALID);
  });

  it('reports its own code when finalize gets a malformed upload id', async () => {
    const response = await finalizeUpload('not-an-upload-id').expect(400);

    expect(response.body.code).toBe(IMPORT_ERROR_CODES.DIRECT_UPLOAD_INVALID);
  });

  it('reports its own code when the upload id was never staged', async () => {
    const response = await finalizeUpload(UNKNOWN_UPLOAD_ID).expect(404);

    expect(response.body.code).toBe(
      IMPORT_ERROR_CODES.DIRECT_UPLOAD_NOT_FOUND,
    );
  });
});
