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

describe('Legal entity accounting profile margin switch (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let tenantA: TestTenantResult;

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
    tenantA = await createTestTenant(prisma, 'aut369mg-ta');
  });

  afterEach(async () => {
    await cleanupTestTenantGraph(prisma, tenantA.tenantId).catch(
      () => undefined,
    );
  });

  afterAll(async () => {
    await teardownTestApp(app, prisma);
  });

  function authHeader(tenant: TestTenantResult) {
    return `Bearer ${createTestAuthToken(authService, tenant)}`;
  }

  it('keeps the stored margin switch and RZL params when a save omits them', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
    const entity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenantA.tenantId },
    });

    const initial = await request(app.getHttpServer())
      .get(`/legal-entities/${entity.id}/accounting-profile`)
      .set('Authorization', authHeader(tenantA))
      .expect(200);

    const withMargin = await request(app.getHttpServer())
      .patch(`/legal-entities/${entity.id}/accounting-profile`)
      .set('Authorization', authHeader(tenantA))
      .send({
        expectedVersion: initial.body.version,
        serializerParams: {
          marginScheme: { enabled: true, vatAccount: '1776' },
        },
      })
      .expect(200);
    expect(withMargin.body.serializer_params.marginScheme).toEqual({
      enabled: true,
      vatAccount: '1776',
    });

    const rzlOnly = await request(app.getHttpServer())
      .patch(`/legal-entities/${entity.id}/accounting-profile`)
      .set('Authorization', authHeader(tenantA))
      .send({
        expectedVersion: withMargin.body.version,
        serializerParams: { rzl: { firmNumber: 'FN-1' } },
      })
      .expect(200);
    expect(rzlOnly.body.serializer_params.marginScheme).toEqual({
      enabled: true,
      vatAccount: '1776',
    });

    const switchedOff = await request(app.getHttpServer())
      .patch(`/legal-entities/${entity.id}/accounting-profile`)
      .set('Authorization', authHeader(tenantA))
      .send({
        expectedVersion: rzlOnly.body.version,
        serializerParams: { marginScheme: { enabled: false } },
      })
      .expect(200);
    expect(switchedOff.body.serializer_params.marginScheme).toEqual({
      enabled: false,
      vatAccount: '1776',
    });

    // Switching back on with only the flag reuses the stored VAT account.
    const switchedOn = await request(app.getHttpServer())
      .patch(`/legal-entities/${entity.id}/accounting-profile`)
      .set('Authorization', authHeader(tenantA))
      .send({
        expectedVersion: switchedOff.body.version,
        serializerParams: { marginScheme: { enabled: true } },
      })
      .expect(200);
    expect(switchedOn.body.serializer_params.marginScheme).toEqual({
      enabled: true,
      vatAccount: '1776',
    });
    expect(switchedOn.body.serializer_params.rzl.firmNumber).toBe('FN-1');
  });
});
