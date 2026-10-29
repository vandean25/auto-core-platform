import { INestApplication } from '@nestjs/common';
import { ImportEntityType, ImportJobStatus, Prisma } from '@prisma/client';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createE2eApp } from './helpers/e2e-suite.js';
import {
  cleanupTestTenantGraph,
  createMemberBearer,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

type SeedJob = {
  entityType?: ImportEntityType;
  sourceSystem?: string;
  status?: ImportJobStatus;
  fileName?: string;
  createdAt?: Date;
  totals?: { create: number; update: number; skip: number; error: number };
  applyFailureCode?: string;
  workerPhase?: 'dry_run' | 'apply';
};

describe('GET /api/imports (job list, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;

  let tenantA: TestTenantResult;
  let tenantB: TestTenantResult;
  let tenantAPrisma: PrismaService;

  let adminA: string;
  let adminB: string;
  let salesA: string;
  let techA: string;

  const baseDate = new Date('2026-01-01T00:00:00.000Z');

  async function seedJob(tenantId: string, seed: SeedJob = {}): Promise<string> {
    const totals = seed.totals ?? { create: 1, update: 0, skip: 0, error: 0 };
    const status = seed.status ?? ImportJobStatus.DRY_RUN_DONE;
    const optionsJson: Prisma.InputJsonObject = {
      ...(seed.applyFailureCode
        ? {
            apply_failure_reason: 'apply_error',
            apply_failure_code: seed.applyFailureCode,
          }
        : {}),
      ...(seed.workerPhase
        ? {
            worker: {
              phase: seed.workerPhase,
              lease_token: 'lease-token',
              lease_until: new Date(Date.now() + 120_000).toISOString(),
              started_at: new Date().toISOString(),
              processed_rows: 0,
            },
          }
        : {}),
    };
    const job = await createTenantAwarePrisma(prisma, tenantId).importJob.create({
      data: {
        tenant_id: tenantId,
        entity_type: seed.entityType ?? ImportEntityType.CUSTOMER,
        source_system: seed.sourceSystem ?? 'synthetic_dms',
        file_name: seed.fileName ?? 'synthetic.csv',
        file_sha256: 'sha-synthetic',
        status,
        mapping_json: { external_id: 'Synthetic-Id' },
        options_json: optionsJson,
        totals_json: { rows: 1, ...totals },
        created_by: null,
        ...(seed.createdAt ? { createdAt: seed.createdAt } : {}),
        ...(status === ImportJobStatus.APPLIED
          ? { appliedAt: seed.createdAt ?? baseDate }
          : {}),
      },
      select: { id: true },
    });
    return job.id;
  }

  let jobA1: string;
  let jobA2: string;
  let jobAVehicle: string;
  let jobASourceB: string;
  let jobAApplied: string;
  let jobAFailed: string;
  let jobB1: string;
  let jobBDryRunApplying: string;
  let jobBApplyPhase: string;

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    authService = app.get(AuthService);

    tenantA = await createTestTenant(prisma, 'import-list-a');
    tenantB = await createTestTenant(prisma, 'import-list-b');
    tenantAPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);

    adminA = `Bearer ${createTestAuthToken(authService, tenantA)}`;
    adminB = `Bearer ${createTestAuthToken(authService, tenantB)}`;
    salesA = await createMemberBearer(prisma, authService, tenantA, 'SALES');
    techA = await createMemberBearer(prisma, authService, tenantA, 'TECH');

    jobA1 = await seedJob(tenantA.tenantId, {
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      fileName: 'oldest.csv',
    });
    jobA2 = await seedJob(tenantA.tenantId, {
      createdAt: new Date('2026-01-05T00:00:00.000Z'),
      fileName: 'newest.csv',
    });
    jobAVehicle = await seedJob(tenantA.tenantId, {
      entityType: ImportEntityType.VEHICLE,
      createdAt: new Date('2026-01-03T00:00:00.000Z'),
    });
    jobASourceB = await seedJob(tenantA.tenantId, {
      sourceSystem: 'synthetic_erp',
      createdAt: new Date('2026-01-04T00:00:00.000Z'),
    });
    jobAApplied = await seedJob(tenantA.tenantId, {
      status: ImportJobStatus.APPLIED,
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    jobAFailed = await seedJob(tenantA.tenantId, {
      status: ImportJobStatus.FAILED,
      applyFailureCode: 'TENANT_LOCKED',
      createdAt: new Date('2026-01-06T00:00:00.000Z'),
    });
    jobB1 = await seedJob(tenantB.tenantId, {
      createdAt: new Date('2026-01-07T00:00:00.000Z'),
    });
    jobBDryRunApplying = await seedJob(tenantB.tenantId, {
      status: ImportJobStatus.APPLYING,
      workerPhase: 'dry_run',
      createdAt: new Date('2026-01-08T00:00:00.000Z'),
    });
    jobBApplyPhase = await seedJob(tenantB.tenantId, {
      status: ImportJobStatus.APPLYING,
      workerPhase: 'apply',
      createdAt: new Date('2026-01-09T00:00:00.000Z'),
    });
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(prisma, tenantA.tenantId);
    await cleanupTestTenantGraph(prisma, tenantB.tenantId);
    await teardownTestApp(app, prisma);
  });

  async function listJobIds(query = '', bearer = adminA): Promise<string[]> {
    const response = await request(app.getHttpServer())
      .get(`/api/imports${query}`)
      .set('Authorization', bearer)
      .expect(200);
    return response.body.data.map((job: { id: string }) => job.id);
  }

  it('lists only the calling tenant jobs, newest first', async () => {
    const ids = await listJobIds();
    expect(ids).not.toContain(jobB1);
    expect(ids).toEqual([
      jobAFailed,
      jobA2,
      jobASourceB,
      jobAVehicle,
      jobAApplied,
      jobA1,
    ]);
  });

  it('returns the list shape without raw row data or PII', async () => {
    await tenantAPrisma.importJobRow.create({
      data: {
        tenant_id: tenantA.tenantId,
        import_job_id: jobA2,
        row_no: 1,
        external_id: 'SECRET-EXT-9',
        action: 'CREATE',
        normalized_json: { last_name: 'Geheimname', vat_id: 'ATU99999999' },
      },
    });

    const response = await request(app.getHttpServer())
      .get('/api/imports')
      .set('Authorization', adminA)
      .expect(200);

    const raw = JSON.stringify(response.body);
    expect(raw).not.toContain('SECRET-EXT-9');
    expect(raw).not.toContain('Geheimname');
    expect(raw).not.toContain('ATU99999999');

    const job = response.body.data.find((row: { id: string }) => row.id === jobA2);
    expect(job).toEqual(
      expect.objectContaining({
        id: jobA2,
        status: 'DRY_RUN_DONE',
        entity_type: 'CUSTOMER',
        source_system: 'synthetic_dms',
        file_name: 'newest.csv',
        totals: { create: 1, update: 0, skip: 0, error: 0 },
        created_at: expect.any(String),
      }),
    );
    expect(job).not.toHaveProperty('rows');
    expect(job).not.toHaveProperty('normalized');
    expect(job).not.toHaveProperty('mapping');
  });

  it('exposes the failure code for FAILED jobs only', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/imports')
      .set('Authorization', adminA)
      .expect(200);

    const failed = response.body.data.find((row: { id: string }) => row.id === jobAFailed);
    expect(failed.status).toBe('FAILED');
    expect(failed.apply_failure_code).toBe('TENANT_LOCKED');

    const applied = response.body.data.find((row: { id: string }) => row.id === jobAApplied);
    expect(applied.apply_failure_code).toBeUndefined();
  });

  it('paginates with page and limit and reports meta', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/imports?page=1&limit=2')
      .set('Authorization', adminA)
      .expect(200);

    expect(response.body.data).toHaveLength(2);
    expect(response.body.meta).toEqual({ total: 6, page: 1, limit: 2 });

    const page2 = await request(app.getHttpServer())
      .get('/api/imports?page=2&limit=2')
      .set('Authorization', adminA)
      .expect(200);
    expect(page2.body.data.map((job: { id: string }) => job.id)).not.toEqual(
      response.body.data.map((job: { id: string }) => job.id),
    );
  });

  it('filters by status', async () => {
    expect(await listJobIds('?status=FAILED')).toEqual([jobAFailed]);
  });

  it('filters by entity type', async () => {
    expect(await listJobIds('?entityType=VEHICLE')).toEqual([jobAVehicle]);
  });

  it('filters by source as a plain string', async () => {
    expect(await listJobIds('?source=synthetic_erp')).toEqual([jobASourceB]);
  });

  it.each(['?page=abc', '?page=Infinity', '?page=1.5', '?page=0', '?limit=1.5', '?limit=abc'])(
    'rejects malformed pagination %s with 400 instead of querying',
    async (query) => {
      await request(app.getHttpServer())
        .get(`/api/imports${query}`)
        .set('Authorization', adminA)
        .expect(400);
    },
  );

  it('marks only a background dry run as cancellable, never the apply phase', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/imports')
      .set('Authorization', adminB)
      .expect(200);

    const byId = new Map<string, { cancellable: boolean }>(
      response.body.data.map((job: { id: string; cancellable: boolean }) => [
        job.id,
        job,
      ]),
    );
    expect(byId.get(jobBDryRunApplying)?.cancellable).toBe(true);
    expect(byId.get(jobBApplyPhase)?.cancellable).toBe(false);
    expect(byId.get(jobB1)?.cancellable).toBe(false);
  });

  it('rejects a tenant admin of another tenant from seeing these jobs', async () => {
    const ids = await listJobIds('', adminB);
    expect(ids).toContain(jobB1);
    expect(ids).not.toContain(jobA1);
  });

  const forbiddenRoles: Array<[string, () => string]> = [
    ['SALES', () => salesA],
    ['TECH', () => techA],
  ];

  describe.each(forbiddenRoles)('%s caller is forbidden', (_role, bearer) => {
    it('rejects GET /api/imports with 403', async () => {
      await request(app.getHttpServer())
        .get('/api/imports')
        .set('Authorization', bearer())
        .expect(403);
    });

    it('rejects resume (GET /api/imports/:id) with 403', async () => {
      await request(app.getHttpServer())
        .get(`/api/imports/${jobA1}`)
        .set('Authorization', bearer())
        .expect(403);
    });

    it('rejects apply (POST /api/imports/:id/apply) with 403', async () => {
      await request(app.getHttpServer())
        .post(`/api/imports/${jobA1}/apply`)
        .set('Authorization', bearer())
        .expect(403);
    });

    it('rejects cancel (POST /api/imports/:id/cancel) with 403', async () => {
      await request(app.getHttpServer())
        .post(`/api/imports/${jobA1}/cancel`)
        .set('Authorization', bearer())
        .expect(403);
    });
  });
});
