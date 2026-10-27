import { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { ImportJobStatus, ImportRowAction } from '@prisma/client';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { serializeCsv } from '../src/import/csv-parse.util.js';
import { ImportCloudTasksService } from '../src/import/import-cloud-tasks.service.js';
import { ImportJobStore } from '../src/import/import-job.store.js';
import { ImportService } from '../src/import/import.service.js';
import { ImportRecoveryService } from '../src/import/import-recovery.service.js';
import { deterministicImportWorkerTaskId } from '../src/import/import-worker-task-identity.js';
import { Prisma } from '@prisma/client';
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

  const customerCsvHeaders = [
    'Kunden-Nr',
    'Typ',
    'Vorname',
    'Nachname',
    'E-Mail',
    'Telefon',
    'UID',
    'Land',
  ];

  beforeAll(async () => {
    cloudTasks = {
      isEnabled: jest.fn().mockReturnValue(true),
      enqueueImportWorker: jest.fn().mockResolvedValue(undefined),
    };

    const configure = (builder: TestingModuleBuilder) =>
      builder.overrideProvider(ImportCloudTasksService).useValue(cloudTasks);

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

  const tenantPrisma = () =>
    createTenantAwarePrisma(basePrisma, tenant.tenantId);

  async function expectOneApplyPerRow(
    jobId: string,
    scope?: { tenantId: string; prisma: typeof tenantPrisma },
  ) {
    const tenantId = scope?.tenantId ?? tenant.tenantId;
    const prisma = scope?.prisma ?? tenantPrisma;
    const job = await prisma().importJob.findFirst({
      where: { id: jobId, tenant_id: tenantId },
    });
    const totals = job?.totals_json as {
      rows: number;
      create: number;
      error: number;
    };
    expect(job?.status).toBe(ImportJobStatus.APPLIED);
    expect(totals.rows).toBe(3);
    expect(totals.create).toBe(3);
    expect(totals.error).toBe(0);

    const errorRowCount = await prisma().importJobRow.count({
      where: { import_job_id: jobId, action: ImportRowAction.ERROR },
    });
    expect(errorRowCount).toBe(0);

    const mappings = await prisma().externalIdMapping.findMany({
      where: {
        tenant_id: tenantId,
        source_system: 'legacy-dms',
        first_seen_import_job_id: jobId,
      },
      select: { external_id: true },
    });
    expect(mappings).toHaveLength(3);
    expect(new Set(mappings.map((mapping) => mapping.external_id)).size).toBe(
      3,
    );
  }

  async function runDryRunUntilDone(jobId: string, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    let job = await tenantPrisma().importJob.findFirst({
      where: { id: jobId },
    });
    while (
      Date.now() < deadline &&
      job?.status !== ImportJobStatus.DRY_RUN_DONE
    ) {
      await deliverWorker(jobId, 'dry_run').expect(204);
      job = await tenantPrisma().importJob.findFirst({ where: { id: jobId } });
    }
    return job;
  }

  const deliverWorker = (
    jobId: string,
    phase: 'dry_run' | 'apply',
    tenantId = tenant.tenantId,
  ) =>
    request(app.getHttpServer())
      .post(`/api/imports/${jobId}/worker`)
      .set('x-cloud-tasks-secret', WORKER_SECRET)
      .set('x-tenant-id', 'ignored-tenant-header')
      .send(signImportTaskPayload({ tenantId, jobId, phase }, WORKER_SECRET));

  function customerCsv(rows: string[][]) {
    return Buffer.from(serializeCsv(customerCsvHeaders, rows, ';'), 'utf8');
  }

  async function uploadBackgroundJob(
    rows: string[][],
    fileName = 'background.csv',
    authToken = token,
  ) {
    const csv = customerCsv(rows);
    const response = await request(app.getHttpServer())
      .post('/api/imports')
      .set('Authorization', `Bearer ${authToken}`)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', 'legacy-dms')
      .field('mapping', JSON.stringify(customerMapping))
      .attach('file', csv, fileName)
      .expect(201);
    return response.body.id as string;
  }

  it('runs background dry-run and apply through the signed worker route', async () => {
    const jobId = await uploadBackgroundJob([
      ['BG-1', 'PRIVATE', 'Erika', 'Eins', 'bg1@example.com', '', '', 'AT'],
      ['BG-2', 'PRIVATE', 'Franz', 'Zwei', 'bg2@example.com', '', '', 'AT'],
      ['BG-3', 'PRIVATE', 'Gabi', 'Drei', 'bg3@example.com', '', '', 'AT'],
    ]);

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

    await expectOneApplyPerRow(jobId);
  });

  describe('overlapping apply (isolated tenant)', () => {
    let overlapTenant: Awaited<ReturnType<typeof createTestTenant>>;
    let overlapToken: string;

    const overlapPrisma = () =>
      createTenantAwarePrisma(basePrisma, overlapTenant.tenantId);

    beforeAll(async () => {
      overlapTenant = await createTestTenant(basePrisma, 'import-bg-overlap');
      overlapToken = createTestAuthToken(app.get(AuthService), overlapTenant);
    });

    afterAll(async () => {
      await cleanupTestTenantGraph(basePrisma, overlapTenant.tenantId);
    });

    it('applies each row once when two worker attempts overlap on apply', async () => {
      const scope = {
        tenantId: overlapTenant.tenantId,
        prisma: overlapPrisma,
      };
      const jobId = await uploadBackgroundJob(
        [
          ['BG-1', 'PRIVATE', 'Erika', 'Eins', 'bg1@example.com', '', '', 'AT'],
          ['BG-2', 'PRIVATE', 'Franz', 'Zwei', 'bg2@example.com', '', '', 'AT'],
          ['BG-3', 'PRIVATE', 'Gabi', 'Drei', 'bg3@example.com', '', '', 'AT'],
        ],
        'background-overlap.csv',
        overlapToken,
      );

      const dryRunDeadline = Date.now() + 60_000;
      let dryRunJob = await overlapPrisma().importJob.findFirst({
        where: { id: jobId },
      });
      while (
        Date.now() < dryRunDeadline &&
        dryRunJob?.status !== ImportJobStatus.DRY_RUN_DONE
      ) {
        await deliverWorker(jobId, 'dry_run', overlapTenant.tenantId).expect(
          204,
        );
        dryRunJob = await overlapPrisma().importJob.findFirst({
          where: { id: jobId },
        });
      }
      const dryRunRowCount = await overlapPrisma().importJobRow.count({
        where: { import_job_id: jobId },
      });
      expect(dryRunJob?.status).toBe(ImportJobStatus.DRY_RUN_DONE);
      expect(dryRunRowCount).toBe(3);

      const plannedCreates = await overlapPrisma().importJobRow.count({
        where: {
          import_job_id: jobId,
          action: ImportRowAction.CREATE,
        },
      });
      expect(plannedCreates).toBe(3);

      await request(app.getHttpServer())
        .post(`/api/imports/${jobId}/apply`)
        .set('Authorization', `Bearer ${overlapToken}`)
        .expect(200);

      await Promise.all([
        deliverWorker(jobId, 'apply', overlapTenant.tenantId).expect(204),
        deliverWorker(jobId, 'apply', overlapTenant.tenantId).expect(204),
      ]);

      const deadline = Date.now() + 60_000;
      let applied = await overlapPrisma().importJob.findFirst({
        where: { id: jobId },
      });
      while (
        Date.now() < deadline &&
        applied?.status !== ImportJobStatus.APPLIED
      ) {
        await Promise.all([
          deliverWorker(jobId, 'apply', overlapTenant.tenantId).expect(204),
          deliverWorker(jobId, 'apply', overlapTenant.tenantId).expect(204),
        ]);
        applied = await overlapPrisma().importJob.findFirst({
          where: { id: jobId },
        });
      }

      await expectOneApplyPerRow(jobId, scope);
    });
  });

  it('recovery picks up a stale APPLYING job in the correct tenant context', async () => {
    const jobId = await uploadBackgroundJob(
      [
        [
          'BG-REC-1',
          'PRIVATE',
          'Rita',
          'Recovery',
          'bgrec1@example.com',
          '',
          '',
          'AT',
        ],
        [
          'BG-REC-2',
          'PRIVATE',
          'Stefan',
          'Recovery',
          'bgrec2@example.com',
          '',
          '',
          'AT',
        ],
        [
          'BG-REC-3',
          'PRIVATE',
          'Tina',
          'Recovery',
          'bgrec3@example.com',
          '',
          '',
          'AT',
        ],
      ],
      'background-recovery.csv',
    );
    const existing = await tenantPrisma().importJob.findFirst({
      where: { id: jobId },
    });
    const options = (existing?.options_json ?? {}) as Record<string, unknown>;
    const worker = (options.worker ?? {}) as Record<string, unknown>;

    await tenantPrisma().importJob.updateMany({
      where: { id: jobId },
      data: {
        status: ImportJobStatus.APPLYING,
        worker_handoff_at: new Date(0),
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
    expect(cloudTasks.enqueueImportWorker).toHaveBeenCalled();

    const deadline = Date.now() + 60_000;
    let job = await tenantPrisma().importJob.findFirst({
      where: { id: jobId },
    });
    while (
      Date.now() < deadline &&
      job?.status !== ImportJobStatus.DRY_RUN_DONE
    ) {
      await deliverWorker(jobId, 'dry_run').expect(204);
      job = await tenantPrisma().importJob.findFirst({ where: { id: jobId } });
    }
    expect(job?.status).toBe(ImportJobStatus.DRY_RUN_DONE);
    const rows = await tenantPrisma().importJobRow.count({
      where: { import_job_id: jobId },
    });
    expect(rows).toBeGreaterThan(0);
  });

  it('completes multi-chunk dry-run handoffs without waiting for recovery', async () => {
    const jobId = await uploadBackgroundJob([
      ['MC-1', 'PRIVATE', 'A', 'One', 'mc1@example.com', '', '', 'AT'],
      ['MC-2', 'PRIVATE', 'B', 'Two', 'mc2@example.com', '', '', 'AT'],
      ['MC-3', 'PRIVATE', 'C', 'Three', 'mc3@example.com', '', '', 'AT'],
      ['MC-4', 'PRIVATE', 'D', 'Four', 'mc4@example.com', '', '', 'AT'],
      ['MC-5', 'PRIVATE', 'E', 'Five', 'mc5@example.com', '', '', 'AT'],
    ]);
    const enqueueCallsBefore = cloudTasks.enqueueImportWorker.mock.calls.length;

    const job = await runDryRunUntilDone(jobId);
    expect(job?.status).toBe(ImportJobStatus.DRY_RUN_DONE);
    expect(
      cloudTasks.enqueueImportWorker.mock.calls.length - enqueueCallsBefore,
    ).toBeGreaterThanOrEqual(2);
  });

  it('resumes after a transaction timeout without ERROR rows', async () => {
    const jobId = await uploadBackgroundJob([
      ['TX-1', 'PRIVATE', 'T', 'One', 'tx1@example.com', '', '', 'AT'],
      ['TX-2', 'PRIVATE', 'T', 'Two', 'tx2@example.com', '', '', 'AT'],
      ['TX-3', 'PRIVATE', 'T', 'Three', 'tx3@example.com', '', '', 'AT'],
    ]);
    const importService = app.get(ImportService);
    const store = (importService as unknown as { jobStore: ImportJobStore })
      .jobStore;
    const realAppend = store.appendDryRunRows.bind(store);
    let failOnce = true;
    jest
      .spyOn(store, 'appendDryRunRows')
      .mockImplementation(async (...args) => {
        if (failOnce) {
          failOnce = false;
          throw new Prisma.PrismaClientKnownRequestError(
            'Transaction API error: Unable to start a transaction in the given time.',
            { code: 'P2028', clientVersion: 'test' },
          );
        }
        return realAppend(...args);
      });

    const job = await runDryRunUntilDone(jobId);
    expect(job?.status).toBe(ImportJobStatus.DRY_RUN_DONE);
    const errorRows = await tenantPrisma().importJobRow.count({
      where: { import_job_id: jobId, action: ImportRowAction.ERROR },
    });
    expect(errorRows).toBe(0);
    jest.restoreAllMocks();
  });

  it('leaves a single successor chain when a worker is killed mid-batch', async () => {
    const jobId = await uploadBackgroundJob([
      ['KILL-1', 'PRIVATE', 'K', 'One', 'kill1@example.com', '', '', 'AT'],
      ['KILL-2', 'PRIVATE', 'K', 'Two', 'kill2@example.com', '', '', 'AT'],
      ['KILL-3', 'PRIVATE', 'K', 'Three', 'kill3@example.com', '', '', 'AT'],
    ]);
    await deliverWorker(jobId, 'dry_run').expect(204);
    const successorIds: string[] = [];
    cloudTasks.enqueueImportWorker.mockImplementation(async (params) => {
      successorIds.push(deterministicImportWorkerTaskId(params.taskIdentity));
    });
    const mid = await tenantPrisma().importJob.findFirst({
      where: { id: jobId },
    });
    const options = (mid?.options_json ?? {}) as Record<string, unknown>;
    const worker = (options.worker ?? {}) as Record<string, unknown>;
    await tenantPrisma().importJob.updateMany({
      where: { id: jobId },
      data: {
        options_json: {
          ...options,
          worker: {
            ...worker,
            lease_until: new Date(0).toISOString(),
          },
        },
      },
    });

    await Promise.all([
      deliverWorker(jobId, 'dry_run').expect(204),
      deliverWorker(jobId, 'dry_run').expect(204),
    ]);

    expect(successorIds.length).toBeGreaterThan(0);
    expect(successorIds.every((id) => id === successorIds[0])).toBe(true);
  });

  it('matches final totals to the dry-run row list', async () => {
    const jobId = await uploadBackgroundJob([
      ['TOT-1', 'PRIVATE', 'S', 'One', 'tot1@example.com', '', '', 'AT'],
      ['TOT-2', 'PRIVATE', 'S', 'Two', 'tot2@example.com', '', '', 'AT'],
      ['TOT-3', 'PRIVATE', 'S', 'Three', 'tot3@example.com', '', '', 'AT'],
    ]);

    const job = await runDryRunUntilDone(jobId);
    expect(job?.status).toBe(ImportJobStatus.DRY_RUN_DONE);

    const rows = await tenantPrisma().importJobRow.findMany({
      where: { import_job_id: jobId },
    });
    const totals = job?.totals_json as ImportJobTotals;
    const counted = {
      create: rows.filter((r) => r.action === ImportRowAction.CREATE).length,
      update: rows.filter((r) => r.action === ImportRowAction.UPDATE).length,
      skip: rows.filter((r) => r.action === ImportRowAction.SKIP).length,
      error: rows.filter((r) => r.action === ImportRowAction.ERROR).length,
    };
    expect(totals.rows).toBe(rows.length);
    expect(totals.create).toBe(counted.create);
    expect(totals.update).toBe(counted.update);
    expect(totals.skip).toBe(counted.skip);
    expect(totals.error).toBe(counted.error);
  });
});

type ImportJobTotals = {
  rows: number;
  create: number;
  update: number;
  skip: number;
  error: number;
};
