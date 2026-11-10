import { jest } from '@jest/globals';
import { VehicleStockStatus } from '@prisma/client';
import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import {
  SCOPE_CONTEXT_HEADER,
} from '../src/auth/scope-context/scope-context.constants.js';
import {
  FakeScopeContextIdpAdapter,
  SCOPE_CONTEXT_IDP_PORT,
} from '../src/auth/scope-context/scope-context-idp.port.js';
import { AppModule } from '../src/app.module.js';
import {
  createGlobalValidationPipe,
  GlobalExceptionFilter,
} from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTenantAwarePrisma,
  createTestTenant,
  resolveTestMainSiteId,
  seedTestTenantMember,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { SystemPrismaService } from '../src/prisma/system-prisma.service.js';
import { stubFirebaseAdminAuthForCustomClaimsE2e } from './helpers/firebase-auth-e2e-mocks.js';
import {
  cleanupE2eTenantGraph,
  teardownTestApp,
} from './test-lifecycle.js';
import { getFirebaseAdminAuth } from '../src/auth/firebase-admin.js';
import { TenantContextStorage } from '../src/common/services/tenant-context.storage.js';

async function createE2eAppWithFakeIdp(): Promise<{
  app: INestApplication;
  idp: FakeScopeContextIdpAdapter;
}> {
  const idp = new FakeScopeContextIdpAdapter();
  const builder = Test.createTestingModule({
    imports: [AppModule],
  }).overrideProvider(SCOPE_CONTEXT_IDP_PORT).useValue(idp);
  const moduleFixture = await builder.compile();
  const app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(createGlobalValidationPipe());
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();
  return { app, idp };
}

describe('scope context (AUT-937 e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let idp: FakeScopeContextIdpAdapter;
  let tenant: TestTenantResult;
  let systemPrisma: SystemPrismaService;
  const extraTenantIds: string[] = [];
  const authTime = 1_700_000_000;

  beforeAll(async () => {
    stubFirebaseAdminAuthForCustomClaimsE2e();
    const boot = await createE2eAppWithFakeIdp();
    app = boot.app;
    idp = boot.idp;
    prisma = app.get(PrismaService);
    authService = app.get(AuthService);
    systemPrisma = app.get(SystemPrismaService);
  });

  async function readEndedLineages(tenantId: string, principalSub: string) {
    return TenantContextStorage.run(async () => {
      TenantContextStorage.setUser({
        userId: principalSub,
        email: 'e2e@example.com',
        tenantId,
        role: 'ADMIN',
      });
      return prisma.endedSessionLineage.findMany({
        where: { principal_sub: principalSub },
      });
    });
  }

  beforeEach(async () => {
    idp.reset();
    tenant = await createTestTenant(prisma, 'scope-context');
    jest.spyOn(getFirebaseAdminAuth(), 'revokeRefreshTokens').mockResolvedValue(undefined);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    for (const tenantId of extraTenantIds) {
      await cleanupE2eTenantGraph(prisma, tenantId);
    }
    extraTenantIds.length = 0;
    await cleanupE2eTenantGraph(prisma, tenant.tenantId);
  });

  afterAll(async () => {
    await teardownTestApp(app, prisma);
  });

  function ownerToken(overrides: { auth_time?: number } = {}) {
    return authService.createTestToken({
      sub: tenant.firebaseUid,
      email: tenant.email,
      tenantId: tenant.tenantId,
      role: 'ADMIN',
      auth_time: overrides.auth_time ?? authTime,
    });
  }

  function handshake(token: string) {
    return request(app.getHttpServer())
      .post('/api/auth/scope-context')
      .set('Authorization', `Bearer ${token}`);
  }

  function logout(token: string) {
    return request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`);
  }

  it('refresh keeps lineage', async () => {
    const refreshA = ownerToken({ auth_time: authTime });
    const refreshB = ownerToken({ auth_time: authTime });

    const first = await handshake(refreshA)
      .expect(HttpStatus.OK)
      .expect('Cache-Control', 'private, no-store');
    const second = await handshake(refreshB).expect(HttpStatus.OK);

    expect(first.body.continuityDigest).toBe(second.body.continuityDigest);
    expect(first.body.scopeContextDigest).toBe(second.body.scopeContextDigest);
  });

  it('ended lineage rejected', async () => {
    const token = ownerToken();
    const revokeMock = getFirebaseAdminAuth().revokeRefreshTokens as jest.Mock;
    const before = await handshake(token).expect(HttpStatus.OK);
    expect(before.body.scopeContext).toEqual(expect.any(String));

    await logout(token).expect(HttpStatus.NO_CONTENT);
    expect(revokeMock).toHaveBeenCalledWith(tenant.firebaseUid);

    const after = await handshake(token).expect(HttpStatus.UNAUTHORIZED);
    expect(after.body.code).toBe('HTTP_401');
  });

  it('revoked at handshake', async () => {
    idp.setMode('revoked');
    const token = ownerToken();
    const response = await handshake(token).expect(HttpStatus.UNAUTHORIZED);
    expect(response.body.code).toBe('HTTP_401');
  });

  it('SC is not a credential', async () => {
    const techUid = `tech-sc-${Date.now()}`;
    const techUser = await prisma.user.create({
      data: { firebaseUid: techUid, email: `${techUid}@example.com` },
    });
    await seedTestTenantMember(prisma, {
      tenantId: tenant.tenantId,
      userId: techUser.id,
      role: 'TECH',
    });
    const siteId = await resolveTestMainSiteId(prisma, tenant.tenantId);
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    await tenantPrisma.siteMembership.create({
      data: {
        tenant_id: tenant.tenantId,
        user_id: techUser.id,
        site_id: siteId,
        is_active: true,
      },
    });
    await systemPrisma.user.update({
      where: { id: techUser.id },
      data: { active_site_id: siteId, active_tenant_id: tenant.tenantId },
    });
    const techToken = authService.createTestToken({
      sub: techUid,
      email: techUser.email,
      tenantId: tenant.tenantId,
      role: 'TECH',
      auth_time: authTime,
    });

    const handshakeRes = await handshake(techToken).expect(HttpStatus.OK);
    const scopeContext = handshakeRes.body.scopeContext as string;

    await request(app.getHttpServer())
      .get('/api/inventory')
      .query({ pagination: 'cursor', limit: '10' })
      .set('Authorization', `Bearer ${scopeContext}`)
      .expect(HttpStatus.UNAUTHORIZED);

    await request(app.getHttpServer())
      .get('/api/inventory')
      .query({ pagination: 'cursor', limit: '10' })
      .set('Authorization', `Bearer ${techToken}`)
      .expect(HttpStatus.FORBIDDEN);

    await request(app.getHttpServer())
      .get('/api/inventory')
      .query({ pagination: 'cursor', limit: '10' })
      .set('Authorization', `Bearer ${techToken}`)
      .set(SCOPE_CONTEXT_HEADER, scopeContext)
      .expect(HttpStatus.FORBIDDEN);
  });

  it('rejects handshake when site membership is inactive', async () => {
    const siteId = await resolveTestMainSiteId(prisma, tenant.tenantId);
    const owner = await prisma.user.findFirstOrThrow({
      where: { firebaseUid: tenant.firebaseUid },
    });
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    await tenantPrisma.siteMembership.updateMany({
      where: {
        tenant_id: tenant.tenantId,
        user_id: owner.id,
        site_id: siteId,
      },
      data: { is_active: false },
    });

    const response = await handshake(ownerToken()).expect(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(response.body.code).toBe('ACTIVE_SITE_REQUIRED');
  });

  it('logout stores site_id only on the session tenant lineage row', async () => {
    const secondTenant = await createTestTenant(prisma, 'scope-context-second');
    extraTenantIds.push(secondTenant.tenantId);
    const owner = await prisma.user.findFirstOrThrow({
      where: { firebaseUid: tenant.firebaseUid },
    });
    await seedTestTenantMember(prisma, {
      tenantId: secondTenant.tenantId,
      userId: owner.id,
      role: 'ADMIN',
    });
    const sessionSiteId = await resolveTestMainSiteId(prisma, tenant.tenantId);
    await prisma.user.update({
      where: { id: owner.id },
      data: {
        active_tenant_id: tenant.tenantId,
        active_site_id: sessionSiteId,
      },
    });

    await logout(ownerToken()).expect(HttpStatus.NO_CONTENT);

    const sessionRows = await readEndedLineages(
      tenant.tenantId,
      tenant.firebaseUid,
    );
    const secondRows = await readEndedLineages(
      secondTenant.tenantId,
      tenant.firebaseUid,
    );
    expect(sessionRows).toHaveLength(1);
    expect(secondRows).toHaveLength(1);
    const sessionRow = sessionRows[0];
    const otherRow = secondRows[0];
    expect(sessionRow?.site_id).toBe(sessionSiteId);
    expect(otherRow?.site_id).toBeNull();
  });

  it('logout returns 503 without recording lineage when revoke fails', async () => {
    const token = ownerToken();
    const revokeMock = getFirebaseAdminAuth().revokeRefreshTokens as jest.Mock;
    revokeMock.mockImplementationOnce(() =>
      Promise.reject(new Error('ETIMEDOUT')),
    );

    await logout(token).expect(HttpStatus.SERVICE_UNAVAILABLE);
    const rows = await readEndedLineages(tenant.tenantId, tenant.firebaseUid);
    expect(rows).toHaveLength(0);
  });

  it('echo without enforcement', async () => {
    const token = ownerToken();
    const handshakeRes = await handshake(token).expect(HttpStatus.OK);
    const scopeContext = handshakeRes.body.scopeContext as string;
    const expectedDigest = handshakeRes.body.scopeContextDigest as string;

    const echoTargets = [
      {
        path: '/api/inventory',
        query: { pagination: 'cursor', limit: '10' },
        digestKey: 'meta' as const,
      },
      {
        path: '/api/inventory/capped-count',
        query: {},
        digestKey: 'root' as const,
      },
      {
        path: '/api/sales/invoices',
        query: { pagination: 'cursor', limit: '10' },
        digestKey: 'meta' as const,
      },
      {
        path: '/api/sales/invoices/capped-count',
        query: {},
        digestKey: 'root' as const,
      },
      {
        path: '/api/vehicle-stock',
        query: {
          pagination: 'cursor',
          limit: '10',
          stock_status: VehicleStockStatus.IN_STOCK,
        },
        digestKey: 'meta' as const,
      },
      {
        path: '/api/vehicle-stock/capped-count',
        query: { stock_status: VehicleStockStatus.IN_STOCK },
        digestKey: 'root' as const,
      },
    ];

    for (const target of echoTargets) {
      const withoutHeader = await request(app.getHttpServer())
        .get(target.path)
        .query(target.query)
        .set('Authorization', `Bearer ${token}`);
      expect(withoutHeader.status).toBe(HttpStatus.OK);

      if (target.digestKey === 'meta') {
        expect(withoutHeader.body.meta?.scopeContextDigest).toBeUndefined();
      } else {
        expect(withoutHeader.body.scopeContextDigest).toBeUndefined();
      }

      const withValid = await request(app.getHttpServer())
        .get(target.path)
        .query(target.query)
        .set('Authorization', `Bearer ${token}`)
        .set(SCOPE_CONTEXT_HEADER, scopeContext)
        .expect(HttpStatus.OK);

      if (target.digestKey === 'meta') {
        expect(withValid.body.meta.scopeContextDigest).toBe(expectedDigest);
      } else {
        expect(withValid.body.scopeContextDigest).toBe(expectedDigest);
      }
    }

    const invalidEcho = await request(app.getHttpServer())
      .get('/api/inventory')
      .query({ pagination: 'cursor', limit: '10' })
      .set('Authorization', `Bearer ${token}`)
      .set(SCOPE_CONTEXT_HEADER, 'not-a-valid-scope-context')
      .expect(HttpStatus.OK);

    expect(invalidEcho.body.meta.scopeContextDigest).toBeUndefined();
  });
});
