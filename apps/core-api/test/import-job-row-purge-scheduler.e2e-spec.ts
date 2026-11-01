import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
  TenantMemberRole,
} from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SystemPrismaService } from '../src/prisma/system-prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { ScheduledJobService } from '../src/scheduler/scheduled-job.service.js';
import { ScheduledJobTriggerService } from '../src/scheduler/scheduled-job-trigger.service.js';
import { ImportCloudTasksService } from '../src/import/import-cloud-tasks.service.js';
import { signImportPurgeTaskPayload } from '../src/import/import-purge-task.payload.js';
import { createE2eApp } from './helpers/e2e-suite.js';
import {
  cleanupTestTenantGraph,
  createMemberBearer,
  createTestAuthToken,
  createTestTenant,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('Import Job Row Purge Scheduler (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let systemPrisma: SystemPrismaService;
  let authService: AuthService;
  let scheduledJobService: ScheduledJobService;
  let triggerService: ScheduledJobTriggerService;
  let cloudTasksService: ImportCloudTasksService;

  let tenant: Awaited<ReturnType<typeof createTestTenant>>;
  let tenantId: string;
  let adminHeader: string;
  let roleHeaders: Record<TenantMemberRole, string>;

  const workerSecret = 'e2e-purge-worker-secret-aut-839';
  const originalEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of [
      'CLOUD_TASKS_WORKER_SECRET',
      'IMPORT_JOB_ROW_PURGE_ROW_BUDGET',
      'IMPORT_JOB_ROW_PURGE_ROW_BATCH_SIZE',
    ]) {
      originalEnv[key] = process.env[key];
    }
    process.env.CLOUD_TASKS_WORKER_SECRET = workerSecret;

    app = await createE2eApp(undefined, { productionErrorFilter: true });
    basePrisma = app.get(PrismaService);
    systemPrisma = app.get(SystemPrismaService);
    authService = app.get(AuthService);
    scheduledJobService = app.get(ScheduledJobService);
    triggerService = app.get(ScheduledJobTriggerService);
    cloudTasksService = app.get(ImportCloudTasksService);

    tenant = await createTestTenant(basePrisma, 'purge-sched');
    tenantId = tenant.tenantId;

    adminHeader = `Bearer ${createTestAuthToken(authService, tenant)}`;
    roleHeaders = {
      OWNER: await createMemberBearer(basePrisma, authService, tenant, 'OWNER'),
      ADMIN: adminHeader,
      SALES: await createMemberBearer(basePrisma, authService, tenant, 'SALES'),
      TECH: await createMemberBearer(basePrisma, authService, tenant, 'TECH'),
      DEMO: await createMemberBearer(basePrisma, authService, tenant, 'DEMO'),
    };
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    if (tenantId) {
      await cleanupTestTenantGraph(basePrisma, tenantId);
    }
    if (app) {
      await teardownTestApp(app, basePrisma);
    }
  });

  describe('Parallel Triggers (Concurrency)', () => {
    it('results in exactly one claim and one loser across two parallel claim calls', async () => {
      const jobName = `test-parallel-claim-${Date.now()}`;
      await scheduledJobService.ensureJobRow(jobName);

      const [res1, res2] = await Promise.all([
        scheduledJobService.tryClaimJob({ jobName }),
        scheduledJobService.tryClaimJob({ jobName }),
      ]);

      const winners = [res1, res2].filter((r) => r.claimed);
      const losers = [res1, res2].filter((r) => !r.claimed);

      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
    });

    it('results in exactly one winner and one enqueue on parallel trigger calls', async () => {
      // Reset claim row for import-job-row-purge
      await systemPrisma.scheduledJobRun.upsert({
        where: { job_name: 'import-job-row-purge' },
        create: { job_name: 'import-job-row-purge' },
        update: {
          last_run_at: new Date('2020-01-01T00:00:00Z'),
          claimed_at: null,
          run_id: null,
        },
      });

      const enqueueSpy = jest
        .spyOn(cloudTasksService, 'enqueueImportPurgeWorker')
        .mockResolvedValue(undefined);
      jest.spyOn(cloudTasksService, 'isEnabled').mockReturnValue(true);

      const [res1, res2] = await Promise.all([
        triggerService.triggerJob('import-job-row-purge'),
        triggerService.triggerJob('import-job-row-purge'),
      ]);

      const trueCount = [res1, res2].filter(Boolean).length;
      expect(trueCount).toBe(1);
      expect(enqueueSpy).toHaveBeenCalledTimes(1);

      enqueueSpy.mockRestore();
    });
  });

  describe('Auth and Role Matrix for Worker Endpoint', () => {
    const workerPath = '/api/imports/maintenance/row-purge/worker';

    it('returns 401 without x-cloud-tasks-secret header', async () => {
      const payload = signImportPurgeTaskPayload(
        { runId: 'run-auth-test', sequence: 0 },
        workerSecret,
      );

      await request(app.getHttpServer())
        .post(workerPath)
        .send(payload)
        .expect(401);
    });

    it('returns 401 with bad x-cloud-tasks-secret header', async () => {
      const payload = signImportPurgeTaskPayload(
        { runId: 'run-auth-test', sequence: 0 },
        workerSecret,
      );

      await request(app.getHttpServer())
        .post(workerPath)
        .set('x-cloud-tasks-secret', 'wrong-secret')
        .send(payload)
        .expect(401);
    });

    it('returns 401 with valid header but bad payload signature', async () => {
      await request(app.getHttpServer())
        .post(workerPath)
        .set('x-cloud-tasks-secret', workerSecret)
        .send({
          runId: 'run-auth-test',
          sequence: 0,
          signature: 'invalid-signature-hex',
        })
        .expect(401);
    });

    it.each(['OWNER', 'ADMIN', 'TECH', 'SALES', 'DEMO'] as const)(
      'rejects normal user token with role %s (401 without worker secret)',
      async (role) => {
        const payload = signImportPurgeTaskPayload(
          { runId: 'run-auth-test', sequence: 0 },
          workerSecret,
        );

        await request(app.getHttpServer())
          .post(workerPath)
          .set('Authorization', roleHeaders[role])
          .send(payload)
          .expect(401);
      },
    );
  });

  describe('Batch Continuation & Stale Task Handling', () => {
    const workerPath = '/api/imports/maintenance/row-purge/worker';

    it('continues batches with sequence + 1 until done, then sets last_run_at and clears claimed_at', async () => {
      // Lower row budget to 2 rows per batch for testing
      process.env.IMPORT_JOB_ROW_PURGE_ROW_BUDGET = '2';

      const now = new Date();
      const ancientDate = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000); // 40 days ago

      // 1. Seed eligible job with 5 rows (> budget 2)
      const eligibleJob = await basePrisma.importJob.create({
        data: {
          tenant_id: tenantId,
          entity_type: ImportEntityType.CUSTOMER,
          source_system: 'e2e-purge-scheduler',
          file_name: 'eligible.csv',
          file_sha256: 'sha-eligible',
          status: ImportJobStatus.FAILED,
          failed_at: ancientDate,
          createdAt: ancientDate,
          updatedAt: ancientDate,
          options_json: { worker: { phase: 'dry_run' } },
          totals_json: { rows: 5, error: 0 },
        },
      });

      await basePrisma.importJobRow.createMany({
        data: [1, 2, 3, 4, 5].map((row_no) => ({
          tenant_id: tenantId,
          import_job_id: eligibleJob.id,
          row_no,
          action: ImportRowAction.CREATE,
        })),
      });

      // 2. Seed non-eligible job with 3 rows (created just now)
      const nonEligibleJob = await basePrisma.importJob.create({
        data: {
          tenant_id: tenantId,
          entity_type: ImportEntityType.CUSTOMER,
          source_system: 'e2e-purge-scheduler',
          file_name: 'non-eligible.csv',
          file_sha256: 'sha-non-eligible',
          status: ImportJobStatus.DRY_RUN_DONE,
          createdAt: now,
          updatedAt: now,
          totals_json: { rows: 3, error: 0 },
        },
      });

      await basePrisma.importJobRow.createMany({
        data: [1, 2, 3].map((row_no) => ({
          tenant_id: tenantId,
          import_job_id: nonEligibleJob.id,
          row_no,
          action: ImportRowAction.CREATE,
        })),
      });

      // Mock Cloud Tasks enqueue to capture re-enqueue sequence calls
      const enqueuedTasks: { runId: string; sequence: number }[] = [];
      const enqueueSpy = jest
        .spyOn(cloudTasksService, 'enqueueImportPurgeWorker')
        .mockImplementation(async (params) => {
          enqueuedTasks.push({ runId: params.runId, sequence: params.sequence });
        });
      jest.spyOn(cloudTasksService, 'isEnabled').mockReturnValue(true);

      // Claim the job in DB
      await systemPrisma.scheduledJobRun.upsert({
        where: { job_name: 'import-job-row-purge' },
        create: { job_name: 'import-job-row-purge' },
        update: {
          last_run_at: new Date('2020-01-01T00:00:00Z'),
          claimed_at: null,
          run_id: null,
        },
      });

      const claim = await scheduledJobService.tryClaimJob({
        jobName: 'import-job-row-purge',
      });
      expect(claim.claimed).toBe(true);
      const activeRunId = (claim as { claimed: true; runId: string }).runId;

      // Invocation sequence 0: purges 2 rows, re-enqueues seq 1
      const payloadSeq0 = signImportPurgeTaskPayload(
        { runId: activeRunId, sequence: 0 },
        workerSecret,
      );

      await request(app.getHttpServer())
        .post(workerPath)
        .set('x-cloud-tasks-secret', workerSecret)
        .send(payloadSeq0)
        .expect(204);

      expect(enqueuedTasks).toHaveLength(1);
      expect(enqueuedTasks[0]).toEqual({ runId: activeRunId, sequence: 1 });

      let eligibleRowsRemaining = await basePrisma.importJobRow.count({
        where: { tenant_id: tenantId, import_job_id: eligibleJob.id },
      });
      expect(eligibleRowsRemaining).toBe(3);

      // Invocation sequence 1: purges 2 rows, re-enqueues seq 2
      const payloadSeq1 = signImportPurgeTaskPayload(
        { runId: activeRunId, sequence: 1 },
        workerSecret,
      );

      await request(app.getHttpServer())
        .post(workerPath)
        .set('x-cloud-tasks-secret', workerSecret)
        .send(payloadSeq1)
        .expect(204);

      expect(enqueuedTasks).toHaveLength(2);
      expect(enqueuedTasks[1]).toEqual({ runId: activeRunId, sequence: 2 });

      eligibleRowsRemaining = await basePrisma.importJobRow.count({
        where: { tenant_id: tenantId, import_job_id: eligibleJob.id },
      });
      expect(eligibleRowsRemaining).toBe(1);

      // Invocation sequence 2: purges final 1 row, completes!
      const payloadSeq2 = signImportPurgeTaskPayload(
        { runId: activeRunId, sequence: 2 },
        workerSecret,
      );

      await request(app.getHttpServer())
        .post(workerPath)
        .set('x-cloud-tasks-secret', workerSecret)
        .send(payloadSeq2)
        .expect(204);

      // No new re-enqueues
      expect(enqueuedTasks).toHaveLength(2);

      // All eligible rows deleted
      eligibleRowsRemaining = await basePrisma.importJobRow.count({
        where: { tenant_id: tenantId, import_job_id: eligibleJob.id },
      });
      expect(eligibleRowsRemaining).toBe(0);

      // Non-eligible rows kept
      const nonEligibleRowsRemaining = await basePrisma.importJobRow.count({
        where: { tenant_id: tenantId, import_job_id: nonEligibleJob.id },
      });
      expect(nonEligibleRowsRemaining).toBe(3);

      // Verify DB state: last_run_at set, claimed_at cleared
      const finalDbRecord = await systemPrisma.scheduledJobRun.findUnique({
        where: { job_name: 'import-job-row-purge' },
      });
      expect(finalDbRecord?.claimed_at).toBeNull();
      expect(finalDbRecord?.last_run_at).toBeDefined();
      expect(finalDbRecord?.last_run_at!.getTime()).toBeGreaterThan(
        Date.now() - 60000,
      );

      enqueueSpy.mockRestore();
    });

    it('treats stale runId and duplicate sequence as a no-op 204 without modifying data', async () => {
      const payload = signImportPurgeTaskPayload(
        { runId: 'stale-run-id-999', sequence: 0 },
        workerSecret,
      );

      await request(app.getHttpServer())
        .post(workerPath)
        .set('x-cloud-tasks-secret', workerSecret)
        .send(payload)
        .expect(204);
    });
  });
});
