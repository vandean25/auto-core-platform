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

describe('Legal entity seller identity (e2e)', () => {
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
    tenantA = await createTestTenant(prisma, 'aut297-ta');
    tenantB = await createTestTenant(prisma, 'aut297-tb');
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

  it('allows OWNER/ADMIN to save incomplete seller settings', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
    const entity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenantA.tenantId },
    });

    const response = await request(app.getHttpServer())
      .patch(`/legal-entities/${entity.id}`)
      .set('Authorization', authHeader(tenantA))
      .send({
        addressStreet: 'Hauptstraße 1',
        addressZip: '1010',
        addressCity: 'Wien',
      })
      .expect(200);

    expect(response.body.address_street).toBe('Hauptstraße 1');
    expect(response.body.seller_readiness.is_ready).toBe(false);
    expect(response.body.seller_readiness.missing_fields).toContain('vat_id');
  });

  it('rejects malformed supplied bank and tax identifiers', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
    const entity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenantA.tenantId },
    });

    await request(app.getHttpServer())
      .patch(`/legal-entities/${entity.id}`)
      .set('Authorization', authHeader(tenantA))
      .send({ vatId: 'AT123' })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/legal-entities/${entity.id}`)
      .set('Authorization', authHeader(tenantA))
      .send({ iban: 'AT00INVALID' })
      .expect(400);
  });

  it('forbids non-admin members from updating seller settings', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
    const entity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenantA.tenantId },
    });
    const salesUser = await tenantPrisma.user.create({
      data: {
        firebaseUid: `aut297-sales-${tenantA.tenantId}`,
        email: `aut297-sales-${tenantA.tenantId}@example.com`,
        active_tenant_id: tenantA.tenantId,
        memberships: {
          create: {
            tenant_id: tenantA.tenantId,
            role: 'SALES',
            is_active: true,
          },
        },
      },
    });

    await request(app.getHttpServer())
      .patch(`/legal-entities/${entity.id}`)
      .set(
        'Authorization',
        `Bearer ${createTestAuthToken(authService, {
          ...tenantA,
          firebaseUid: salesUser.firebaseUid!,
          email: salesUser.email,
        })}`,
      )
      .send({ addressStreet: 'Blocked Street' })
      .expect(403);
  });

  it('returns 404 for another tenant legal entity', async () => {
    const tenantBPrisma = createTenantAwarePrisma(prisma, tenantB.tenantId);
    const foreignEntity = await tenantBPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenantB.tenantId },
    });

    await request(app.getHttpServer())
      .patch(`/legal-entities/${foreignEntity.id}`)
      .set('Authorization', authHeader(tenantA))
      .send({ addressStreet: 'Should not apply' })
      .expect(404);
  });

  it('marks a complete DE profile as ready', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
    const entity = await tenantPrisma.legalEntity.create({
      data: {
        tenant_id: tenantA.tenantId,
        name: 'Berlin Motors GmbH',
        country_iso: 'DE',
        is_active: true,
      },
    });

    const response = await request(app.getHttpServer())
      .patch(`/legal-entities/${entity.id}`)
      .set('Authorization', authHeader(tenantA))
      .send({
        addressStreet: 'Unter den Linden 1',
        addressZip: '10117',
        addressCity: 'Berlin',
        taxNumber: '12/345/67890',
        paymentTermsDays: 14,
      })
      .expect(200);

    expect(response.body.seller_readiness.is_ready).toBe(true);
    expect(response.body.seller_readiness.missing_fields).toEqual([]);
  });
});
