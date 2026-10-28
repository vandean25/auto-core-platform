import { INestApplication } from '@nestjs/common';
import { ImportJobStatus } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { serializeCsv } from '../src/import/csv-parse.util.js';
import { ImportCloudTasksService } from '../src/import/import-cloud-tasks.service.js';
import {
  IMPORT_DIRECT_UPLOAD_LOCAL_ROOT,
  writeLocalDirectUploadStagingObject,
} from '../src/import/import-direct-upload.storage.js';
import { IMPORT_LOCAL_UPLOAD_ROOT } from '../src/import/import-file.storage.js';
import { MIGRATION_MANIFEST_ERROR_CODES } from '../src/import/migration-manifest.errors.js';
import { parseMigrationManifestJson } from '../src/import/migration-manifest.validator.js';
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

const customerMapping = {
  external_id: 'Kunden-Nr',
  type: 'Typ',
  first_name: 'Vorname',
  last_name: 'Nachname',
  email: 'E-Mail',
  phone: 'Telefon',
  vat_id: 'UID',
  address_country: 'Land',
};

function customerCsv(): Buffer {
  return Buffer.from(
    serializeCsv(
      [
        'Kunden-Nr',
        'Typ',
        'Vorname',
        'Nachname',
        'E-Mail',
        'Telefon',
        'UID',
        'Land',
      ],
      [['DIR-1', 'PRIVATE', 'Erika', 'Muster', 'direct@example.com', '', '', 'AT']],
      ';',
    ),
    'utf8',
  );
}

describe('Direct GCS import upload (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let tenantA: Awaited<ReturnType<typeof createTestTenant>>;
  let tenantB: Awaited<ReturnType<typeof createTestTenant>>;
  let authHeaderA: string;
  let authHeaderB: string;
  let authHeaderEmployee: string;
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
    process.env.IMPORT_UPLOAD_BUCKET = 'direct-upload-e2e-bucket';
    process.env.IMPORT_DIRECT_UPLOAD_MAX_FILE_BYTES = String(MAX_BYTES);
    process.env.CLOUD_TASKS_ENABLED = 'false';

    const cloudTasks = {
      isEnabled: jest.fn().mockReturnValue(false),
      enqueueImportWorker: jest.fn().mockResolvedValue(undefined),
    };
    app = await createE2eApp((builder) =>
      builder.overrideProvider(ImportCloudTasksService).useValue(cloudTasks),
    );
    basePrisma = app.get(PrismaService);
    const auth = app.get(AuthService);
    tenantA = await createTestTenant(basePrisma, 'import-direct-a');
    tenantB = await createTestTenant(basePrisma, 'import-direct-b');
    authHeaderA = `Bearer ${createTestAuthToken(auth, tenantA)}`;
    authHeaderB = `Bearer ${createTestAuthToken(auth, tenantB)}`;
    const salesEmail = `e2e-sales-${tenantA.tenantId}@example.com`;
    const salesFirebaseUid = `e2e-sales-${tenantA.tenantId}`;
    await basePrisma.user.create({
      data: {
        firebaseUid: salesFirebaseUid,
        email: salesEmail,
        active_tenant_id: tenantA.tenantId,
        memberships: {
          create: {
            tenant_id: tenantA.tenantId,
            role: 'SALES',
            is_active: true,
          },
        },
      },
      select: { id: true },
    });
    authHeaderEmployee = `Bearer ${createTestAuthToken(auth, {
      tenantId: tenantA.tenantId,
      firebaseUid: salesFirebaseUid,
      email: salesEmail,
      role: 'SALES',
    })}`;
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await cleanupTestTenantGraph(basePrisma, tenantA.tenantId);
    await cleanupTestTenantGraph(basePrisma, tenantB.tenantId);
    await teardownTestApp(app, basePrisma);
    for (const tenantId of [tenantA.tenantId, tenantB.tenantId]) {
      await rm(join(IMPORT_DIRECT_UPLOAD_LOCAL_ROOT, 'import-uploads', 'tenants', tenantId), {
        recursive: true,
        force: true,
      });
      await rm(join(IMPORT_LOCAL_UPLOAD_ROOT, 'tenants', tenantId), {
        recursive: true,
        force: true,
      });
    }
  });

  const tenantPrisma = () =>
    createTenantAwarePrisma(basePrisma, tenantA.tenantId);

  function startDirectUpload(
    payload: Record<string, unknown> = { fileName: 'report.csv', size: 100 },
    authHeader = authHeaderA,
  ) {
    return request(app.getHttpServer())
      .post('/api/imports/direct-uploads')
      .set('Authorization', authHeader)
      .send(payload);
  }

  function finalizeDirectUpload(
    uploadId: string,
    payload: Record<string, unknown>,
    authHeader = authHeaderA,
  ) {
    return request(app.getHttpServer())
      .post(`/api/imports/direct-uploads/${uploadId}/finalize`)
      .set('Authorization', authHeader)
      .send(payload);
  }

  function finalizePayload(fileName = 'report.csv', size = 100) {
    return {
      fileName,
      size,
      entityType: 'CUSTOMER',
      sourceSystem: 'legacy-direct',
      mapping: customerMapping,
      options: {},
    };
  }

  async function stagingExists(
    tenantId: string,
    uploadId: string,
    fileName = 'report.csv',
  ) {
    try {
      await access(
        join(
          IMPORT_DIRECT_UPLOAD_LOCAL_ROOT,
          'import-uploads',
          'tenants',
          tenantId,
          uploadId,
          fileName,
        ),
      );
      return true;
    } catch {
      return false;
    }
  }

  async function waitForDryRun(jobId: string, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    let job = await tenantPrisma().importJob.findFirst({ where: { id: jobId } });
    while (Date.now() < deadline && job?.status !== ImportJobStatus.DRY_RUN_DONE) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      job = await tenantPrisma().importJob.findFirst({ where: { id: jobId } });
    }
    return job;
  }

  it('requires an authenticated tenant admin for start and finalize', async () => {
    await request(app.getHttpServer())
      .post('/api/imports/direct-uploads')
      .send({ fileName: 'report.csv', size: 100 })
      .expect(401);

    await startDirectUpload(undefined, authHeaderEmployee).expect(403);
    await finalizeDirectUpload(
      'not-a-real-upload-id',
      finalizePayload(),
      authHeaderEmployee,
    ).expect(403);
  });

  it('issues a tenant-scoped upload URL with the declared size cap', async () => {
    const response = await startDirectUpload({
      fileName: '..\\..\\quarterly report.csv',
      size: 100,
      contentType: 'text/csv',
    }).expect(201);

    expect(response.body.upload_url).toContain(
      `/import-uploads/tenants/${tenantA.tenantId}/${response.body.upload_id}/quarterly report.csv?max=`,
    );
    expect(response.body.headers).toEqual({
      'x-goog-resumable': 'start',
      'Content-Type': 'text/csv',
    });
    expect(response.body.max_bytes).toBe(100);
    expect(
      new Date(response.body.expires_at).getTime() - Date.now(),
    ).toBeLessThanOrEqual(16 * 60 * 1000);
  });

  it('rejects uploads above the server cap and non-CSV files', async () => {
    const tooLarge = await startDirectUpload({
      fileName: 'report.csv',
      size: MAX_BYTES + 1,
    }).expect(413);
    expect(tooLarge.body.code).toBe('IMPORT_DIRECT_UPLOAD_TOO_LARGE');

    const wrongType = await startDirectUpload({
      fileName: 'report.xlsx',
      size: 100,
    }).expect(400);
    expect(wrongType.body.code).toBe('IMPORT_DIRECT_UPLOAD_INVALID');
  });

  it('finalizes a staged upload into the job location and runs the dry-run', async () => {
    const csv = customerCsv();
    const started = await startDirectUpload({
      fileName: 'report.csv',
      size: csv.byteLength,
    }).expect(201);
    const uploadId = started.body.upload_id as string;

    await writeLocalDirectUploadStagingObject({
      tenantId: tenantA.tenantId,
      uploadId,
      fileName: 'report.csv',
      content: csv,
    });

    const finalized = await finalizeDirectUpload(
      uploadId,
      finalizePayload('report.csv', csv.byteLength),
    ).expect(201);
    const jobId = finalized.body.id as string;

    const job = await waitForDryRun(jobId);
    expect(job?.status).toBe(ImportJobStatus.DRY_RUN_DONE);
    expect(job?.file_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((job?.totals_json as { create: number }).create).toBe(1);

    const uploadKey = (
      job?.options_json as { upload?: { object_key?: string } }
    ).upload?.object_key;
    expect(uploadKey).toBe(
      `tenants/${tenantA.tenantId}/imports/${jobId}/report.csv`,
    );
    await expect(
      access(join(IMPORT_LOCAL_UPLOAD_ROOT, uploadKey!)),
    ).resolves.toBeUndefined();

    await expect(stagingExists(tenantA.tenantId, uploadId)).resolves.toBe(false);
  });

  it('rejects finalize for another tenant or a missing staging object', async () => {
    const csv = customerCsv();
    const started = await startDirectUpload({
      fileName: 'report.csv',
      size: csv.byteLength,
    }).expect(201);
    const uploadId = started.body.upload_id as string;
    await writeLocalDirectUploadStagingObject({
      tenantId: tenantA.tenantId,
      uploadId,
      fileName: 'report.csv',
      content: csv,
    });

    const otherTenant = await finalizeDirectUpload(
      uploadId,
      finalizePayload('report.csv', csv.byteLength),
      authHeaderB,
    ).expect(404);
    expect(otherTenant.body.code).toBe('IMPORT_DIRECT_UPLOAD_NOT_FOUND');

    const missing = await finalizeDirectUpload(
      '00000000-0000-4000-8000-000000000000',
      finalizePayload('report.csv', 100),
    ).expect(404);
    expect(missing.body.code).toBe('IMPORT_DIRECT_UPLOAD_NOT_FOUND');

    const traversal = await finalizeDirectUpload(
      uploadId,
      finalizePayload('../../other.csv', csv.byteLength),
    ).expect(404);
    expect(traversal.body.code).toBe('IMPORT_DIRECT_UPLOAD_NOT_FOUND');
  });

  it('rejects and deletes a staged object above the declared size cap', async () => {
    const started = await startDirectUpload({
      fileName: 'report.csv',
      size: 100,
    }).expect(201);
    const uploadId = started.body.upload_id as string;
    await writeLocalDirectUploadStagingObject({
      tenantId: tenantA.tenantId,
      uploadId,
      fileName: 'report.csv',
      content: Buffer.alloc(MAX_BYTES + 1, 'a'),
    });

    const response = await finalizeDirectUpload(
      uploadId,
      finalizePayload('report.csv', 100),
    ).expect(413);
    expect(response.body.code).toBe('IMPORT_DIRECT_UPLOAD_TOO_LARGE');
    await expect(stagingExists(tenantA.tenantId, uploadId)).resolves.toBe(false);
  });

  it('rejects and deletes a direct upload that violates the migration manifest', async () => {
    const customers = readFileSync(
      join(process.cwd(), 'test/fixtures/migration-csv-v1/customers.csv'),
    );
    const manifest = parseMigrationManifestJson(
      readFileSync(
        join(process.cwd(), 'test/fixtures/migration-csv-v1/manifest.json'),
      ),
    );
    manifest.control_totals.stock_value = '100.00';

    const started = await startDirectUpload({
      fileName: 'customers.csv',
      size: customers.byteLength,
    }).expect(201);
    const uploadId = started.body.upload_id as string;
    await writeLocalDirectUploadStagingObject({
      tenantId: tenantA.tenantId,
      uploadId,
      fileName: 'customers.csv',
      content: customers,
    });

    await finalizeDirectUpload(uploadId, {
      ...finalizePayload('customers.csv', customers.byteLength),
      options: { migration_manifest: manifest },
    })
      .expect(400)
      .expect((response) => {
        const codes = (response.body.issues ?? []).map(
          (issue: { code?: string }) => issue.code,
        );
        expect(codes).toContain(
          MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_NOT_RECONCILED,
        );
      });
    await expect(
      stagingExists(tenantA.tenantId, uploadId, 'customers.csv'),
    ).resolves.toBe(false);
  });
});
