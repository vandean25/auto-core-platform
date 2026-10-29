import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { listImportEntityTypes } from '../src/import/import-entity-type.registry.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createE2eApp } from './helpers/e2e-suite.js';
import {
  cleanupTestTenantGraph,
  createTestAuthToken,
  createTestTenant,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('GET /api/imports/entity-types (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let tenant: Awaited<ReturnType<typeof createTestTenant>>;
  let adminAuthHeader: string;
  let salesAuthHeader: string;

  beforeAll(async () => {
    app = await createE2eApp();
    basePrisma = app.get(PrismaService);
    const auth = app.get(AuthService);
    tenant = await createTestTenant(basePrisma, 'import-entity-types');
    adminAuthHeader = `Bearer ${createTestAuthToken(auth, tenant)}`;
    const salesEmail = `e2e-sales-${tenant.tenantId}@example.com`;
    const salesFirebaseUid = `e2e-sales-${tenant.tenantId}`;
    await basePrisma.user.create({
      data: {
        firebaseUid: salesFirebaseUid,
        email: salesEmail,
        active_tenant_id: tenant.tenantId,
        memberships: {
          create: {
            tenant_id: tenant.tenantId,
            role: 'SALES',
            is_active: true,
          },
        },
      },
      select: { id: true },
    });
    salesAuthHeader = `Bearer ${createTestAuthToken(auth, {
      tenantId: tenant.tenantId,
      firebaseUid: salesFirebaseUid,
      email: salesEmail,
      role: 'SALES',
    })}`;
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(basePrisma, tenant.tenantId);
    await teardownTestApp(app, basePrisma);
  });

  it('returns the registry to tenant admins', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/imports/entity-types')
      .set('Authorization', adminAuthHeader)
      .expect(200);

    expect(response.body).toEqual({ data: listImportEntityTypes() });
  });

  it('rejects sales users with 403', async () => {
    await request(app.getHttpServer())
      .get('/api/imports/entity-types')
      .set('Authorization', salesAuthHeader)
      .expect(403);
  });
});
