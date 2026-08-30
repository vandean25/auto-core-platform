import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service';
import { createGlobalValidationPipe } from '../src/common';
import { SANDBOX_CATALOG_QUERY } from '../src/catalog/catalog-adapter-ids';
import { verifyCatalogHitPayload } from '../src/catalog/catalog-hit-payload';
import { seedVehicleCatalogProviders } from '../src/prisma/seed-vehicle-catalog-providers';
import { createIdentityInputFingerprint } from '../src/vehicle/vehicle-identity.util';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
  seedTestTenantMember,
} from './tenant-test-utils';
import { teardownTestApp } from './test-lifecycle';

describe('Catalog external search (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let authToken: string;
  let techAuthToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    basePrisma = app.get(PrismaService);
    const testTenant = await createTestTenant(
      basePrisma,
      'catalog-external',
    );
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    authToken = createTestAuthToken(app.get(AuthService), testTenant);

    await runWithTenantContext(tenantId, async () => {
      await seedVehicleCatalogProviders(basePrisma, tenantId);

      const techFirebaseUid = `tech-catalog-external-${tenantId}`;
      const techUser = await basePrisma.user.create({
        data: {
          firebaseUid: techFirebaseUid,
          email: `tech-catalog-external-${tenantId}@example.com`,
        },
      });
      await seedTestTenantMember(basePrisma, {
        tenantId,
        userId: techUser.id,
        role: 'TECH',
      });
      techAuthToken = createTestAuthToken(app.get(AuthService), {
        ...testTenant,
        firebaseUid: techUser.firebaseUid,
        email: techUser.email,
        role: 'TECH',
      });
    });
  });

  afterAll(async () => {
    try {
      if (basePrisma && tenantId) {
        await cleanupTestTenantGraph(basePrisma, tenantId);
      }
    } finally {
      await teardownTestApp(app, basePrisma);
    }
  });

  async function createResolvedPeugeotOrder() {
    const ts = Date.now();
    const peugeotBrand = await prisma.brand.findFirst({
      where: { tenant_id: tenantId, normalized_name: 'PEUGEOT' },
    });
    if (!peugeotBrand) {
      throw new Error('Peugeot brand seed missing');
    }

    const vin = `VF1AUT233${ts}`;
    const plate = `EXT-${ts}`;
    const vehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        vin,
        plate,
        make: 'Peugeot',
        model: '308',
        year: 2020,
        make_brand_id: peugeotBrand.id,
        identity_keys: { vin },
        identity_input_fingerprint: createIdentityInputFingerprint(vin, plate),
        identity_resolved_at: new Date(),
      },
    });

    const customer = await prisma.customer.create({
      data: {
        tenant_id: tenantId,
        first_name: 'External',
        last_name: 'Catalog',
        email: `catalog-external-${ts}@example.com`,
      },
    });

    const workshopOrder = await prisma.workshopOrder.create({
      data: {
        tenant_id: tenantId,
        customer_id: customer.id,
        vehicle_id: vehicle.id,
        order_number: `WO-EXT-${ts}`,
        status: 'INTAKE',
        odometer: 0,
        fuel_level: 50,
      },
    });

    return { vehicle, workshopOrder };
  }

  it('returns 409 when vehicle identity is stale', async () => {
    const ts = Date.now();
    const vehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        vin: `STALE${ts}`,
        plate: `ST-${ts}`,
        make: 'Peugeot',
        model: '308',
        year: 2020,
      },
    });
    const customer = await prisma.customer.create({
      data: {
        tenant_id: tenantId,
        first_name: 'Stale',
        last_name: 'Identity',
        email: `stale-${ts}@example.com`,
      },
    });
    const workshopOrder = await prisma.workshopOrder.create({
      data: {
        tenant_id: tenantId,
        customer_id: customer.id,
        vehicle_id: vehicle.id,
        order_number: `WO-STALE-${ts}`,
        status: 'INTAKE',
        odometer: 0,
        fuel_level: 50,
      },
    });

    await request(app.getHttpServer())
      .get('/api/catalog/external/search')
      .query({
        workshopOrderId: workshopOrder.id,
        concern: 'PARTS',
        q: 'brake',
      })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(409);
  });

  it('returns OEM parts hits for concern=PARTS without labor array', async () => {
    const { workshopOrder } = await createResolvedPeugeotOrder();

    const response = await request(app.getHttpServer())
      .get('/api/catalog/external/search')
      .query({
        workshopOrderId: workshopOrder.id,
        concern: 'PARTS',
        q: 'brake pad',
      })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body).toMatchObject({
      concern: 'PARTS',
      sourceUsed: 'OEM',
      oemStatus: 'HIT',
      fallbackRequired: false,
      fallbackReason: null,
      retryOemAvailable: true,
    });
    expect(response.body.items.length).toBeGreaterThan(0);
    expect(response.body.items[0]).toMatchObject({
      sourceSystem: 'stellantis',
      hitToken: expect.any(String),
    });
    expect(response.body).not.toHaveProperty('labor');
    expect(response.body).not.toHaveProperty('sourceBanner');

    const claims = verifyCatalogHitPayload(response.body.items[0].hitToken);
    expect(claims.concern).toBe('PARTS');
    expect(claims.workshopOrderId).toBe(workshopOrder.id);
  });

  it('returns fallbackRequired when OEM is empty without confirmFallback', async () => {
    const { workshopOrder } = await createResolvedPeugeotOrder();

    const response = await request(app.getHttpServer())
      .get('/api/catalog/external/search')
      .query({
        workshopOrderId: workshopOrder.id,
        concern: 'PARTS',
        q: SANDBOX_CATALOG_QUERY.EMPTY,
      })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body).toMatchObject({
      sourceUsed: 'OEM',
      oemStatus: 'EMPTY',
      fallbackRequired: true,
      fallbackReason: 'EMPTY',
      items: [],
    });
  });

  it('returns aftermarket items when OEM is empty with confirmFallback=true', async () => {
    const { workshopOrder } = await createResolvedPeugeotOrder();

    const response = await request(app.getHttpServer())
      .get('/api/catalog/external/search')
      .query({
        workshopOrderId: workshopOrder.id,
        concern: 'PARTS',
        q: SANDBOX_CATALOG_QUERY.EMPTY,
        confirmFallback: true,
      })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body).toMatchObject({
      sourceUsed: 'AFTERMARKET',
      oemStatus: 'EMPTY',
      fallbackRequired: false,
      fallbackReason: 'EMPTY',
    });
    expect(response.body.items.length).toBeGreaterThan(0);
    expect(response.body.items[0].sourceSystem).toBe('tecdoc');
  });

  it('returns fallbackRequired when OEM errors without confirmFallback', async () => {
    const { workshopOrder } = await createResolvedPeugeotOrder();

    const response = await request(app.getHttpServer())
      .get('/api/catalog/external/search')
      .query({
        workshopOrderId: workshopOrder.id,
        concern: 'PARTS',
        q: SANDBOX_CATALOG_QUERY.ERROR,
      })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body).toMatchObject({
      sourceUsed: 'OEM',
      oemStatus: 'ERROR',
      fallbackRequired: true,
      fallbackReason: 'ERROR',
      retryOemAvailable: true,
      items: [],
    });
  });

  it('returns aftermarket list when source=AFTERMARKET after OEM hit', async () => {
    const { workshopOrder } = await createResolvedPeugeotOrder();

    const response = await request(app.getHttpServer())
      .get('/api/catalog/external/search')
      .query({
        workshopOrderId: workshopOrder.id,
        concern: 'PARTS',
        q: 'brake pad',
        source: 'AFTERMARKET',
      })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body).toMatchObject({
      sourceUsed: 'AFTERMARKET',
      fallbackRequired: false,
    });
    expect(response.body.items.length).toBeGreaterThan(0);
    expect(response.body.items[0].sourceSystem).toBe('tecdoc');
  });

  it('does not write inventory rows during external search', async () => {
    const { workshopOrder } = await createResolvedPeugeotOrder();
    const txBefore = await prisma.inventoryTransaction.count({
      where: { tenant_id: tenantId },
    });
    const stockBefore = await prisma.inventoryStock.count({
      where: { tenant_id: tenantId },
    });

    await request(app.getHttpServer())
      .get('/api/catalog/external/search')
      .query({
        workshopOrderId: workshopOrder.id,
        concern: 'PARTS',
        q: 'brake pad',
        confirmFallback: true,
      })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const txAfter = await prisma.inventoryTransaction.count({
      where: { tenant_id: tenantId },
    });
    const stockAfter = await prisma.inventoryStock.count({
      where: { tenant_id: tenantId },
    });

    expect(txAfter).toBe(txBefore);
    expect(stockAfter).toBe(stockBefore);
  });

  it('returns assembly groups for concern=PARTS', async () => {
    const { workshopOrder } = await createResolvedPeugeotOrder();

    const response = await request(app.getHttpServer())
      .get('/api/catalog/external/assembly-groups')
      .query({
        workshopOrderId: workshopOrder.id,
        concern: 'PARTS',
      })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.groups.length).toBeGreaterThan(0);
    expect(response.body.groups[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
    });
  });

  it('blocks TECH sessions from external search', async () => {
    const { workshopOrder } = await createResolvedPeugeotOrder();

    await request(app.getHttpServer())
      .get('/api/catalog/external/search')
      .query({
        workshopOrderId: workshopOrder.id,
        concern: 'PARTS',
        q: 'brake',
      })
      .set('Authorization', `Bearer ${techAuthToken}`)
      .expect(403);
  });

  it('leaves GET /api/catalog/search unchanged', async () => {
    const { workshopOrder } = await createResolvedPeugeotOrder();

    const response = await request(app.getHttpServer())
      .get('/api/catalog/search')
      .query({
        workshopOrderId: workshopOrder.id,
        q: 'brake',
      })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body).toHaveProperty('labor');
    expect(response.body).toHaveProperty('parts');
    expect(response.body).toHaveProperty('meta');
    expect(response.body).not.toHaveProperty('concern');
  });
});
