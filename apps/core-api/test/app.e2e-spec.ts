import { createE2eApp } from './helpers/e2e-suite.js';
import { AuthService } from '../src/auth/auth.service.js';

import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestAuthToken, createTestTenant, cleanupTestTenantGraph } from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('AppController (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let prisma: PrismaService;
  let tenantId: string;

  beforeAll(() => {
  });

  beforeEach(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    const testTenant = await createTestTenant(prisma, 'app-root');
    tenantId = testTenant.tenantId;
    authToken = createTestAuthToken(app.get(AuthService), testTenant);
  });

  afterEach(async () => {
    if (tenantId) {
      await cleanupTestTenantGraph(prisma, tenantId);
      tenantId = '';
    }
    await teardownTestApp(app, prisma);
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/api')
        .set('Authorization', `Bearer ${authToken}`)
      .expect(200)
      .expect('Hello World!');
  });

  it('/health (GET) is public and does not require a token', () => {
    return request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('rejects unknown properties on validated DTOs', async () => {
    await request(app.getHttpServer())
      .post('/api/inventory/locations')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Test location',
        code: 'TEST',
        type: 'warehouse',
        unexpected: true,
      })
      .expect(400);
  });
});
