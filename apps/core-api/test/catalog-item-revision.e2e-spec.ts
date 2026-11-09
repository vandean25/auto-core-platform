import { createE2eApp } from './helpers/e2e-suite.js';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTestAuthToken,
  createTestTenant,
  createTenantAwarePrisma,
  runWithTenantContext,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('catalog item revision (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let authTokenAdmin: string;
  let testTenant: Awaited<ReturnType<typeof createTestTenant>>;

  beforeEach(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    testTenant = await createTestTenant(prisma, 'catalog-revision');
    tenantId = testTenant.tenantId;
    authTokenAdmin = createTestAuthToken(app.get(AuthService), testTenant);
  });

  afterEach(async () => {
    if (tenantId) {
      await cleanupTestTenantGraph(prisma, tenantId);
      tenantId = '';
    }
    await teardownTestApp(app, prisma);
  });

  it('legacy patch increases revision', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
    const item = await tenantPrisma.catalogItem.create({
      data: {
        tenant_id: tenantId,
        sku: 'REV-PATCH-001',
        name: 'Revision patch part',
        retail_price: 10,
        unit: 'pcs',
      },
    });
    const before = Number(item.revision);

    const response = await request(app.getHttpServer())
      .patch(`/api/inventory/${item.id}`)
      .set('Authorization', `Bearer ${authTokenAdmin}`)
      .send({
        sku: 'REV-PATCH-001',
        name: 'Revision patch part',
        cost_price: 5,
        retail_price: 11.5,
      })
      .expect(200);

    expect(response.body.revision).toBeGreaterThan(before);
    const afterRow = await tenantPrisma.catalogItem.findFirstOrThrow({
      where: { id: item.id },
    });
    expect(Number(afterRow.revision)).toBe(response.body.revision);
    expect(Number(afterRow.revision)).toBeGreaterThan(before);
  });

  it('non-Prisma writer increases revision', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
    const item = await tenantPrisma.catalogItem.create({
      data: {
        tenant_id: tenantId,
        sku: 'REV-MANY-001',
        name: 'UpdateMany part',
        retail_price: 20,
        unit: 'pcs',
      },
    });
    const before = Number(item.revision);

    await runWithTenantContext(tenantId, async () => {
      await prisma.catalogItem.updateMany({
        where: { tenant_id: tenantId, id: item.id },
        data: { retail_price: 21 },
      });
    });

    const afterRow = await tenantPrisma.catalogItem.findFirstOrThrow({
      where: { id: item.id },
    });
    expect(Number(afterRow.revision)).toBeGreaterThan(before);
  });

  it('recreate never reuses revision', async () => {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
    const fixedId = '00000000-0000-4000-8000-000000000101';
    const first = await tenantPrisma.catalogItem.create({
      data: {
        id: fixedId,
        tenant_id: tenantId,
        sku: 'REV-RECREATE-001',
        name: 'First life',
        retail_price: 9,
        unit: 'pcs',
      },
    });
    const firstRevision = Number(first.revision);

    await runWithTenantContext(tenantId, async () => {
      await prisma.catalogItem.delete({ where: { id: fixedId } });
    });

    const second = await tenantPrisma.catalogItem.create({
      data: {
        id: fixedId,
        tenant_id: tenantId,
        sku: 'REV-RECREATE-002',
        name: 'Second life',
        retail_price: 12,
        unit: 'pcs',
      },
    });
    expect(Number(second.revision)).toBeGreaterThan(firstRevision);
  });
});
