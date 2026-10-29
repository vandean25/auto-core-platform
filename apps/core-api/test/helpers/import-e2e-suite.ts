import type { INestApplication } from '@nestjs/common';
import type { ImportEntityType, TenantMemberRole } from '@prisma/client';
import request from 'supertest';
import { AuthService } from '../../src/auth/auth.service.js';
import { serializeCsv } from '../../src/import/csv-parse.util.js';
import type { ImportJobResponseDto } from '../../src/import/dto/import-job-response.dto.js';
import type {
  DryRunRowResult,
  ImportJobOptions,
} from '../../src/import/import.types.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
} from '../tenant-test-utils.js';
import { teardownTestApp } from '../test-lifecycle.js';
import { createE2eApp } from './e2e-suite.js';

export function setupImportE2eSuite(prefix: string) {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let tenant: Awaited<ReturnType<typeof createTestTenant>>;
  let otherTenant: Awaited<ReturnType<typeof createTestTenant>>;
  let prisma: PrismaService;
  let token: string;
  let otherToken: string;

  beforeAll(async () => {
    app = await createE2eApp();
    basePrisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    tenant = await createTestTenant(basePrisma, `${prefix}-a`);
    otherTenant = await createTestTenant(basePrisma, `${prefix}-b`);
    prisma = createTenantAwarePrisma(basePrisma, tenant.tenantId);
    token = createTestAuthToken(app.get(AuthService), tenant);
    otherToken = createTestAuthToken(app.get(AuthService), otherTenant);
  });
  afterEach(async () => {
    await cleanupTestTenantGraph(basePrisma, tenant.tenantId);
    await cleanupTestTenantGraph(basePrisma, otherTenant.tenantId);
  });
  afterAll(async () => {
    if (app) await teardownTestApp(app, basePrisma);
  });

  return {
    get app() {
      return app;
    },
    get basePrisma() {
      return basePrisma;
    },
    get tenant() {
      return tenant;
    },
    get otherTenant() {
      return otherTenant;
    },
    get prisma() {
      return prisma;
    },
    get token() {
      return token;
    },
    get otherToken() {
      return otherToken;
    },
  };
}

export function createImportTestClient(
  suite: ReturnType<typeof setupImportE2eSuite>,
  config: {
    entityType: ImportEntityType;
    sourceSystem: string;
    headers: string[];
    auditEntityTypes: string[];
  },
) {
  const mapping = Object.fromEntries(
    config.headers.map((header) => [header, header]),
  );

  function upload(
    rows: Record<string, string>[] | Buffer,
    options: ImportJobOptions = {},
    bearer = suite.token,
  ) {
    const csv = Buffer.isBuffer(rows)
      ? rows
      : Buffer.from(
          serializeCsv(
            config.headers,
            rows.map((row) =>
              config.headers.map((header) => row[header] ?? ''),
            ),
            ';',
          ),
          'utf8',
        );
    return request(suite.app.getHttpServer())
      .post('/api/imports')
      .set('Authorization', `Bearer ${bearer}`)
      .field('entityType', config.entityType)
      .field('sourceSystem', config.sourceSystem)
      .field('mapping', JSON.stringify(mapping))
      .field('options', JSON.stringify(options))
      .attach('file', csv, 'synthetic-import.csv');
  }

  async function dryRun(
    rows: Record<string, string>[] | Buffer,
    options: ImportJobOptions = {},
    bearer = suite.token,
  ): Promise<ImportJobResponseDto> {
    const response = await upload(rows, options, bearer).expect(201);
    expect(response.body.status).toBe('DRY_RUN_DONE');
    return response.body as ImportJobResponseDto;
  }

  async function applyJob(
    jobId: string,
    bearer = suite.token,
  ): Promise<ImportJobResponseDto> {
    await request(suite.app.getHttpServer())
      .post(`/api/imports/${jobId}/apply`)
      .set('Authorization', `Bearer ${bearer}`)
      .expect(202);
    const response = await request(suite.app.getHttpServer())
      .get(`/api/imports/${jobId}`)
      .set('Authorization', `Bearer ${bearer}`)
      .expect(200);
    expect(response.body.status).toBe('APPLIED');
    return response.body as ImportJobResponseDto;
  }

  async function rowsOf(
    jobId: string,
    bearer = suite.token,
  ): Promise<DryRunRowResult[]> {
    const response = await request(suite.app.getHttpServer())
      .get(`/api/imports/${jobId}/rows?limit=100`)
      .set('Authorization', `Bearer ${bearer}`)
      .expect(200);
    return response.body.data as DryRunRowResult[];
  }

  async function errorsCsv(jobId: string): Promise<string> {
    const response = await request(suite.app.getHttpServer())
      .get(`/api/imports/${jobId}/errors.csv`)
      .set('Authorization', `Bearer ${suite.token}`)
      .expect(200)
      .expect('Content-Type', /text\/csv/);
    return response.text;
  }

  function mappings() {
    return suite.prisma.externalIdMapping.findMany({
      where: {
        tenant_id: suite.tenant.tenantId,
        entity_type: config.entityType,
        source_system: config.sourceSystem,
      },
      orderBy: { external_id: 'asc' },
    });
  }

  function audits(jobId: string) {
    return suite.prisma.auditLog.findMany({
      where: {
        tenant_id: suite.tenant.tenantId,
        entity_type: { in: config.auditEntityTypes },
        source: 'import',
        after: { path: ['importJobId'], equals: jobId },
      },
    });
  }

  async function expectHidden(jobId: string, bearer: string): Promise<void> {
    const server = request(suite.app.getHttpServer());
    await Promise.all(
      [
        server.get(`/api/imports/${jobId}`),
        server.get(`/api/imports/${jobId}/rows`),
        server.get(`/api/imports/${jobId}/errors.csv`),
        server.post(`/api/imports/${jobId}/apply`),
      ].map((operation) =>
        operation.set('Authorization', `Bearer ${bearer}`).expect(404),
      ),
    );
  }

  async function expectForbidden(
    jobId: string,
    rows: Record<string, string>[],
    role: Extract<TenantMemberRole, 'SALES' | 'TECH'>,
  ): Promise<void> {
    await suite.prisma.tenantMember.updateMany({
      where: { tenant_id: suite.tenant.tenantId },
      data: { role },
    });
    const restrictedToken = createTestAuthToken(suite.app.get(AuthService), {
      ...suite.tenant,
      role,
    });
    await upload(rows, {}, restrictedToken).expect(403);
    await request(suite.app.getHttpServer())
      .post(`/api/imports/${jobId}/apply`)
      .set('Authorization', `Bearer ${restrictedToken}`)
      .expect(403);
  }

  async function applyWithTotals(
    job: ImportJobResponseDto,
    totals: Partial<ImportJobResponseDto['totals']>,
    bearer = suite.token,
  ): Promise<ImportJobResponseDto> {
    expect(job.totals).toMatchObject(totals);
    const applied = await applyJob(job.id, bearer);
    expect(applied.totals).toMatchObject(totals);
    return applied;
  }

  async function expectUnapplied(jobId: string): Promise<void> {
    const job = await suite.prisma.importJob.findFirstOrThrow({
      where: { tenant_id: suite.tenant.tenantId, id: jobId },
    });
    expect(job.status).toBe('DRY_RUN_DONE');
    expect(await mappings()).toHaveLength(0);
    expect(await audits(jobId)).toHaveLength(0);
  }

  return {
    dryRun,
    applyJob,
    applyWithTotals,
    rowsOf,
    errorsCsv,
    mappings,
    audits,
    expectHidden,
    expectForbidden,
    expectUnapplied,
  };
}
