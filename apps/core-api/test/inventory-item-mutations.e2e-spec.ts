import { createE2eApp } from './helpers/e2e-suite.js';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { LocationType } from '@prisma/client';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTestAuthToken,
  createTestTenant,
  createTenantAwarePrisma,
  resolveTestMainSiteId,
  runWithTenantContext,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('Inventory item mutations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let authTokenAdmin: string;
  let testTenant: Awaited<ReturnType<typeof createTestTenant>>;
  let catalogItemId: string;
  let binLocationId: string;

  beforeEach(async () => {
    app = await createE2eApp();

    prisma = app.get(PrismaService);
    testTenant = await createTestTenant(prisma, 'inventory-mutations');
    tenantId = testTenant.tenantId;
    authTokenAdmin = createTestAuthToken(app.get(AuthService), testTenant);

    const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
    const siteId = await resolveTestMainSiteId(prisma, tenantId);
    const catalogItem = await tenantPrisma.catalogItem.create({
      data: {
        tenant_id: tenantId,
        sku: 'DEMO-PART-001',
        name: 'Demo filter',
        cost_price: 4.5,
        retail_price: 9.99,
        unit: 'pcs',
      },
    });
    catalogItemId = catalogItem.id;

    const warehouse = await tenantPrisma.storageLocation.create({
      data: {
        tenant_id: tenantId,
        code: 'WH-DEMO-01',
        name: 'Demo warehouse',
        type: LocationType.warehouse,
        site_id: siteId,
      },
    });
    const bin = await tenantPrisma.storageLocation.create({
      data: {
        tenant_id: tenantId,
        code: 'BIN-DEMO-01',
        name: 'Demo bin A1',
        type: LocationType.bin,
        site_id: siteId,
        parent_id: warehouse.id,
      },
    });
    binLocationId = bin.id;
  });

  afterEach(async () => {
    if (tenantId) {
      await cleanupTestTenantGraph(prisma, tenantId);
      tenantId = '';
    }
    await teardownTestApp(app, prisma);
  });

  it('receives stock and exposes the ledger entry', async () => {
    await request(app.getHttpServer())
      .post(`/api/inventory/${catalogItemId}/receive`)
      .set('Authorization', `Bearer ${authTokenAdmin}`)
      .send({ locationId: binLocationId, quantity: 3 })
      .expect(204);

    const history = await request(app.getHttpServer())
      .get(`/api/inventory/${catalogItemId}/history`)
      .set('Authorization', `Bearer ${authTokenAdmin}`)
      .expect(200);

    expect(history.body[0]).toMatchObject({
      type: 'PURCHASE_RECEIPT',
      quantity: '3',
      reference_id: 'manual-receipt',
    });
  });

  it('rejects adjustments that would drive stock negative', async () => {
    await request(app.getHttpServer())
      .post(`/api/inventory/${catalogItemId}/adjust`)
      .set('Authorization', `Bearer ${authTokenAdmin}`)
      .send({
        locationId: binLocationId,
        quantity: -5,
        reason: 'Cycle count correction',
      })
      .expect(400);
  });

  it('forbids TECH users from receiving stock', async () => {
    await runWithTenantContext(tenantId, async () => {
      await prisma.tenantMember.updateMany({
        where: { tenant_id: tenantId },
        data: { role: 'TECH' },
      });
    });

    const authTokenTech = createTestAuthToken(
      app.get(AuthService),
      { ...testTenant, role: 'TECH' },
      { role: 'TECH' },
    );

    await request(app.getHttpServer())
      .post(`/api/inventory/${catalogItemId}/receive`)
      .set('Authorization', `Bearer ${authTokenTech}`)
      .send({ locationId: binLocationId, quantity: 1 })
      .expect(403);
  });
});
