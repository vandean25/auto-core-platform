import { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { ImportJobStatus } from '@prisma/client';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { serializeCsv } from '../src/import/csv-parse.util.js';
import { ImportCloudTasksService } from '../src/import/import-cloud-tasks.service.js';
import { ImportRecoveryService } from '../src/import/import-recovery.service.js';
import { signImportTaskPayload } from '../src/import/import-task.payload.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createE2eApp } from './helpers/e2e-suite.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

const WORKER_SECRET = 'import-background-worker-e2e-secret';

describe('Import background worker (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let tenant: Awaited<ReturnType<typeof createTestTenant>>;
  let token: string;
  let cloudTasks: { isEnabled: jest.Mock; enqueueImportWorker: jest.Mock };
  const saved: Record<string, string | undefined> = {};

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

  beforeAll(async () => {
    cloudTasks = {
      isEnabled: jest.fn().mockReturnValue(true),
      enqueueImportWorker: jest.fn().mockResolvedValue(undefined),
    };

    const configure = (builder: TestingModuleBuilder) =>
      builder
        .overrideProvider(ImportCloudTasksService)
        .useValue(cloudTasks);

    app = await createE2eApp(configure);
    basePrisma = app.get(PrismaService);
    const auth = app.get(AuthService);
    tenant = await createTestTenant(basePrisma, 'import-bg-worker');
    token = createTestAuthToken(auth, tenant);

    for (const key of [
      'CLOUD_TASKS_WORKER_SECRET',
      'IMPORT_SYNC_MAX_ROW_COUNT',
      'IMPORT_UPLOAD_STORAGE',
      'CLOUD_TASKS_TARGET_BASE_URL',
      'IMPORT_WORKER_BATCH_SIZE',
    ]) {
      saved[key] = process.env[key];
    }
    process.env.CLOUD_TASKS_WORKER_SECRET = WORKER_SECRET;
    process.env.IMPORT_SYNC_MAX_ROW_COUNT = '2';
    process.env.IMPORT_UPLOAD_STORAGE = 'local';
    process.env.CLOUD_TASKS_TARGET_BASE_URL = 'http://127.0.0.1:3000/api/';
    process.env.IMPORT_WORKER_BATCH_SIZE = '2';
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await cleanupTestTenantGraph(basePrisma, tenant.tenantId);
    await teardownTestApp(app, basePrisma);
  });

  const tenantPrisma = () => createTenantAwarePrisma(basePrisma, tenant.tenantId);

  const deliverWorker = (
    jobId: string,
    phase: 'dry_run' | 'apply',
    tenantId = tenant.tenantId,
  ) =>
    request(app.getHttpServer())
      .post(`/api/imports/${jobId}/worker`)
      .set('x-cloud-tasks-secret', WORKER_SECRET)
      .set('x-tenant-id', 'ignored-tenant-header')
      .send(
        signImportTaskPayload(
          { tenantId, jobId, phase },
          WORKER_SECRET,
        ),
      );

  function customerCsv(rows: string[][]) {
    const headers = Object.keys(customerMapping);
    return Buffer.from(serializeCsv(headers, rows, ';'), 'utf8');
  }

  async function uploadBackgroundJob() {
    const csv = customerCsv([
      ['BG-1', 'PRIVATE', 'Erika', 'Eins', 'bg1@example.com', '', '', 'AT'],
      ['BG-2', 'PRIVATE', 'Franz', 'Zwei', 'bg2@example.com', '', '', 'AT'],
      ['BG-3', 'PRIVATE', 'Gabi', 'Drei', 'bg3@example.com', '', '', 'AT'],
    ]);
    const response = await request(app.getHttpServer())
      .post('/api/imports')
      .set('Authorization', `Bearer ${token}`)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', 'legacy-dms')
      .field('mapping', JSON.stringify(customerMapping))
      .attach('file', csv, 'background.csv')
      .expect(201);
    return response.body.id as string;
  }

  it('runs background dry-run and apply through the signed worker route', async () => {
    const jobId = await uploadBackgroundJob();

    await deliverWorker(jobId, 'dry_run').expect(204);
    await deliverWorker(jobId, 'dry_run').expect(204);

    const dryRunDone = await tenantPrisma().importJob.findFirst({
      where: { id: jobId },
    });
    expect(dryRunDone?.status).toBe(ImportJobStatus.DRY_RUN_DONE);

    const rowCount = await tenantPrisma().importJobRow.count({
      where: { import_job_id: jobId },
    });
    expect(rowCount).toBeGreaterThan(0);

    await request(app.getHttpServer())
      .post(`/api/imports/${jobId}/apply`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await deliverWorker(jobId, 'apply').expect(204);

    const applied = await tenantPrisma().importJob.findFirst({
      where: { id: jobId },
    });
    expect(applied?.status).toBe(ImportJobStatus.APPLIED);
    expect((applied?.totals_json as { rows: number }).rows).toBe(3);
  });

  it('applies each row once when two worker attempts overlap on apply', async () => {
    const jobId = await uploadBackgroundJob();

    await deliverWorker(jobId, 'dry_run').expect(204);
    await deliverWorker(jobId, 'dry_run').expect(204);

    const beforeApply = await tenantPrisma().importJob.findFirst({
      where: { id: jobId },
    });
    expect(beforeApply?.status).toBe(ImportJobStatus.DRY_RUN_DONE);

    await request(app.getHttpServer())
      .post(`/api/imports/${jobId}/apply`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const job = await tenantPrisma().importJob.findFirst({
        where: { id: jobId },
      });
      if (job?.status === ImportJobStatus.APPLIED) {
        break;
      }
      await Promise.all([
        deliverWorker(jobId, 'apply'),
        deliverWorker(jobId, 'apply'),
      ]);
    }

    const applied = await tenantPrisma().importJob.findFirst({
      where: { id: jobId },
    });
    expect(applied?.status).toBe(ImportJobStatus.APPLIED);
    expect((applied?.totals_json as { rows: number }).rows).toBe(3);

    const mappings = await tenantPrisma().externalIdMapping.findMany({
      where: {
        tenant_id: tenant.tenantId,
        entity_type: 'CUSTOMER',
        source_system: 'legacy-dms',
      },
    });
    expect(mappings).toHaveLength(3);
    expect(new Set(mappings.map((row) => row.external_id)).size).toBe(3);

    const options = (applied?.options_json ?? {}) as Record<string, unknown>;
    expect(options.upload).toBeDefined();
  });

  it('recovery picks up a stale APPLYING job in the correct tenant context', async () => {
    const jobId = await uploadBackgroundJob();
    const existing = await tenantPrisma().importJob.findFirst({
      where: { id: jobId },
    });
    const options = (existing?.options_json ?? {}) as Record<string, unknown>;
    const worker = (options.worker ?? {}) as Record<string, unknown>;

    await tenantPrisma().importJob.updateMany({
      where: { id: jobId },
      data: {
        status: ImportJobStatus.APPLYING,
        options_json: {
          ...options,
          worker: {
            ...worker,
            phase: 'dry_run',
            lease_token: 'stale-lease',
            lease_until: new Date(0).toISOString(),
            processed_rows: 0,
          },
        },
      },
    });

    await app.get(ImportRecoveryService).run();

    const job = await tenantPrisma().importJob.findFirst({ where: { id: jobId } });
    expect(job?.status).toBe(ImportJobStatus.DRY_RUN_DONE);
    const rows = await tenantPrisma().importJobRow.count({
      where: { import_job_id: jobId },
    });
    expect(rows).toBeGreaterThan(0);
  });
});
