import { jest } from '@jest/globals';
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
  createTestTenant,
  resolveTestMainSiteId,
  seedTestTenantMember,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { stubFirebaseAdminAuthForCustomClaimsE2e } from './helpers/firebase-auth-e2e-mocks.js';
import {
  cleanupE2eTenantGraph,
  teardownTestApp,
} from './test-lifecycle.js';
import { getFirebaseAdminAuth } from '../src/auth/firebase-admin.js';

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
  const authTime = 1_700_000_000;

  beforeAll(async () => {
    stubFirebaseAdminAuthForCustomClaimsE2e();
    const boot = await createE2eAppWithFakeIdp();
    app = boot.app;
    idp = boot.idp;
    prisma = app.get(PrismaService);
    authService = app.get(AuthService);
  });

  beforeEach(async () => {
    idp.reset();
    tenant = await createTestTenant(prisma, 'scope-context');
    jest.spyOn(getFirebaseAdminAuth(), 'revokeRefreshTokens').mockResolvedValue(undefined);
  });

  afterEach(async () => {
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

    const first = await handshake(refreshA).expect(HttpStatus.OK);
    const second = await handshake(refreshB).expect(HttpStatus.OK);

    expect(first.body.continuityDigest).toBe(second.body.continuityDigest);
    expect(first.body.scopeContextDigest).toBe(second.body.scopeContextDigest);
  });

  it('ended lineage rejected', async () => {
    const token = ownerToken();
    const before = await handshake(token).expect(HttpStatus.OK);
    expect(before.body.scopeContext).toEqual(expect.any(String));

    await logout(token).expect(HttpStatus.NO_CONTENT);

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
    await prisma.user.update({
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

    await handshake(techToken).expect(HttpStatus.OK);

    await request(app.getHttpServer())
      .get('/api/inventory')
      .query({ pagination: 'cursor', limit: '10' })
      .set('Authorization', `Bearer ${techToken}`)
      .expect(HttpStatus.FORBIDDEN);
  });

  it('echo without enforcement', async () => {
    const token = ownerToken();
    const handshakeRes = await handshake(token).expect(HttpStatus.OK);
    const scopeContext = handshakeRes.body.scopeContext as string;
    const expectedDigest = handshakeRes.body.scopeContextDigest as string;

    const withoutHeader = await request(app.getHttpServer())
      .get('/api/inventory')
      .query({ pagination: 'cursor', limit: '10' })
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);

    expect(withoutHeader.body.meta.scopeContextDigest).toBeUndefined();

    const withValid = await request(app.getHttpServer())
      .get('/api/inventory')
      .query({ pagination: 'cursor', limit: '10' })
      .set('Authorization', `Bearer ${token}`)
      .set(SCOPE_CONTEXT_HEADER, scopeContext)
      .expect(HttpStatus.OK);

    expect(withValid.body.meta.scopeContextDigest).toBe(expectedDigest);
    expect(withValid.body.data).toEqual(withoutHeader.body.data);
    expect(withValid.body.meta.nextCursor).toEqual(withoutHeader.body.meta.nextCursor);
    expect(withValid.body.meta.hasNextPage).toBe(
      withoutHeader.body.meta.hasNextPage,
    );

    await request(app.getHttpServer())
      .get('/api/inventory')
      .query({ pagination: 'cursor', limit: '10' })
      .set('Authorization', `Bearer ${token}`)
      .set(SCOPE_CONTEXT_HEADER, 'not-a-valid-scope-context')
      .expect(HttpStatus.OK);
  });
});
