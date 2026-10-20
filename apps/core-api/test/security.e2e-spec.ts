import { createE2eApp } from './helpers/e2e-suite.js';
import { AuthService } from '../src/auth/auth.service.js';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { cleanupTestTenantGraph, createTestAuthToken, createTestTenant } from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('Security (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let prisma: PrismaService;
  let tenantId: string;

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    const testTenant = await createTestTenant(prisma, 'security-root');
    tenantId = testTenant.tenantId;
    authToken = createTestAuthToken(app.get(AuthService), testTenant);
  });

  afterAll(async () => {
    if (tenantId) {
      await cleanupTestTenantGraph(prisma, tenantId);
    }
    await teardownTestApp(app, prisma);
  });

  it('should allow access with valid API key', () => {
    return request(app.getHttpServer())
      .get('/api')
        .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
  });

  it('should block access without API key', () => {
    return request(app.getHttpServer()).get('/api').expect(401);
  });

  it('should block access with invalid API key', () => {
    return request(app.getHttpServer())
      .get('/api')
        .set('Authorization', `Bearer invalid-token`)
      .expect(401);
  });
});
