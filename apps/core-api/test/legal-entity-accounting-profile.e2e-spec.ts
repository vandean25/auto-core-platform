import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('Legal entity accounting profile (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let tenantA: TestTenantResult;
  let tenantB: TestTenantResult;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    authService = app.get<AuthService>(AuthService);
  });

  beforeEach(async () => {
    tenantA = await createTestTenant(prisma, 'aut297ap-ta');
    tenantB = await createTestTenant(prisma, 'aut297ap-tb');
  });

  afterEach(async () => {
    await cleanupTestTenantGraph(prisma, tenantA.tenantId).catch(() => undefined);
    await cleanupTestTenantGraph(prisma, tenantB.tenantId).catch(() => undefined);
  });

  afterAll(async () => {
    await teardownTestApp(app, prisma);
  });

  function authHeader(tenant: TestTenantResult) {
    return `Bearer ${createTestAuthToken(authService, tenant)}`;
  }

  it('creates a default profile on first GET and reports incomplete readiness', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
    const entity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenantA.tenantId },
    });

    const response = await request(app.getHttpServer())
      .get(`/legal-entities/${entity.id}/accounting-profile`)
      .set('Authorization', authHeader(tenantA))
      .expect(200);

    expect(response.body.legal_entity_id).toBe(entity.id);
    expect(response.body.version).toBe(1);
    expect(response.body.is_enabled).toBe(false);
    expect(response.body.mapping_rules).toEqual([]);
    expect(response.body.mapping_readiness.is_ready).toBe(false);
    expect(response.body.required_source_categories.length).toBeGreaterThan(0);
  });

  it('allows OWNER/ADMIN to save incomplete profile fields', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
    const entity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenantA.tenantId },
    });

    const initial = await request(app.getHttpServer())
      .get(`/legal-entities/${entity.id}/accounting-profile`)
      .set('Authorization', authHeader(tenantA))
      .expect(200);

    const response = await request(app.getHttpServer())
      .patch(`/legal-entities/${entity.id}/accounting-profile`)
      .set('Authorization', authHeader(tenantA))
      .send({
        expectedVersion: initial.body.version,
        advisorNumber: '12345',
        clientNumber: '1',
      })
      .expect(200);

    expect(response.body.advisor_number).toBe('12345');
    expect(response.body.client_number).toBe('1');
    expect(response.body.version).toBe(2);
    expect(response.body.mapping_readiness.is_ready).toBe(false);
  });

  it('drops incomplete mapping rules while saving other profile fields', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
    const entity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenantA.tenantId },
    });

    const initial = await request(app.getHttpServer())
      .get(`/legal-entities/${entity.id}/accounting-profile`)
      .set('Authorization', authHeader(tenantA))
      .expect(200);

    const response = await request(app.getHttpServer())
      .patch(`/legal-entities/${entity.id}/accounting-profile`)
      .set('Authorization', authHeader(tenantA))
      .send({
        expectedVersion: initial.body.version,
        advisorNumber: '12345',
        mappingRules: [
          {
            sourceCategoryKey: 'labor',
            sourceCategoryLabel: 'Labor',
            taxMode: 'STANDARD',
            taxRate: '20.00',
            revenueAccount: '',
            taxTreatment: 'automatic',
          },
        ],
      })
      .expect(200);

    expect(response.body.advisor_number).toBe('12345');
    expect(response.body.mapping_rules).toEqual([]);
    expect(response.body.mapping_readiness.is_ready).toBe(false);
  });

  it('rejects enabling DATEV export before mapping readiness is complete', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
    const entity = await tenantPrisma.legalEntity.create({
      data: {
        tenant_id: tenantA.tenantId,
        name: 'Berlin Motors GmbH',
        country_iso: 'DE',
        is_active: true,
      },
    });

    const initial = await request(app.getHttpServer())
      .get(`/legal-entities/${entity.id}/accounting-profile`)
      .set('Authorization', authHeader(tenantA))
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/legal-entities/${entity.id}/accounting-profile`)
      .set('Authorization', authHeader(tenantA))
      .send({
        expectedVersion: initial.body.version,
        isEnabled: true,
      })
      .expect(400);
  });

  it('returns 404 for another tenant legal entity', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
    const entity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenantA.tenantId },
    });

    await request(app.getHttpServer())
      .get(`/legal-entities/${entity.id}/accounting-profile`)
      .set('Authorization', authHeader(tenantB))
      .expect(404);
  });

  it('rejects stale expectedVersion with 409', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
    const entity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenantA.tenantId },
    });

    const initial = await request(app.getHttpServer())
      .get(`/legal-entities/${entity.id}/accounting-profile`)
      .set('Authorization', authHeader(tenantA))
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/legal-entities/${entity.id}/accounting-profile`)
      .set('Authorization', authHeader(tenantA))
      .send({
        expectedVersion: initial.body.version + 99,
        advisorNumber: '99999',
      })
      .expect(409);
  });
});
