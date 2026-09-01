import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service';
import { createGlobalValidationPipe } from '../src/common';
import { SANDBOX_CATALOG_QUERY } from '../src/catalog/catalog-adapter-ids';
import {
  signCatalogHitPayload,
  verifyCatalogHitPayload,
} from '../src/catalog/catalog-hit-payload';
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

function resignCatalogHitToken(
  token: string,
  overrides: Record<string, unknown>,
): string {
  const claims = verifyCatalogHitPayload(token);
  const { jti: _jti, exp: _exp, ...signableClaims } = claims;
  void _jti;
  void _exp;
  return signCatalogHitPayload({ ...signableClaims, ...overrides });
}

function createLaborHitToken(params: {
  tenantId: string;
  workshopOrderId: string;
  vehicleId: string;
  taskId: string;
  externalId: string;
  plannedHours: number | null;
}): string {
  return signCatalogHitPayload({
    tenantId: params.tenantId,
    workshopOrderId: params.workshopOrderId,
    vehicleId: params.vehicleId,
    taskId: params.taskId,
    concern: 'LABOR',
    sourceSystem: 'haynes',
    externalId: params.externalId,
    name: 'Catalog labor operation',
    externalOperationCode: params.externalId,
    standardAw: 12,
    plannedHours: params.plannedHours,
  });
}

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
    const testTenant = await createTestTenant(basePrisma, 'catalog-external');
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

    const task = await prisma.workshopTask.create({
      data: {
        tenant_id: tenantId,
        workshop_order_id: workshopOrder.id,
        title: 'External catalog task',
      },
    });

    return { vehicle, workshopOrder, task };
  }

  it('requires taskId for external catalog search', async () => {
    const { workshopOrder } = await createResolvedPeugeotOrder();

    await request(app.getHttpServer())
      .get('/api/catalog/external/search')
      .query({
        workshopOrderId: workshopOrder.id,
        concern: 'PARTS',
        q: 'brake',
      })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(400);
  });

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
    const task = await prisma.workshopTask.create({
      data: {
        tenant_id: tenantId,
        workshop_order_id: workshopOrder.id,
        title: 'Stale identity task',
      },
    });

    await request(app.getHttpServer())
      .get('/api/catalog/external/search')
      .query({
        workshopOrderId: workshopOrder.id,
        taskId: task.id,
        concern: 'PARTS',
        q: 'brake',
      })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(409);
  });

  it('returns OEM parts hits for concern=PARTS without labor array', async () => {
    const { workshopOrder, task } = await createResolvedPeugeotOrder();

    const response = await request(app.getHttpServer())
      .get('/api/catalog/external/search')
      .query({
        workshopOrderId: workshopOrder.id,
        taskId: task.id,
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
    expect(claims.taskId).toBe(task.id);
  });

  it('creates and replays a catalog hit as a workshop task line', async () => {
    const { workshopOrder, task } = await createResolvedPeugeotOrder();
    const searchResponse = await request(app.getHttpServer())
      .get('/api/catalog/external/search')
      .query({
        workshopOrderId: workshopOrder.id,
        taskId: task.id,
        concern: 'PARTS',
        q: 'brake pad',
      })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    const hitToken = searchResponse.body.items[0].hitToken;

    const firstResponse = await request(app.getHttpServer())
      .post(
        `/api/workshop/orders/${workshopOrder.id}/tasks/${task.id}/lines/from-catalog`,
      )
      .send({ hitToken })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(firstResponse.body).toMatchObject({
      line: {
        type: 'PART',
        catalogItemId: expect.any(String),
        catalogHitJti: expect.any(String),
        qty: 1,
      },
      lineItemsVersion: 1,
    });

    const replayResponse = await request(app.getHttpServer())
      .post(
        `/api/workshop/orders/${workshopOrder.id}/tasks/${task.id}/lines/from-catalog`,
      )
      .send({ hitToken })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(replayResponse.body).toEqual(firstResponse.body);
    expect(
      await prisma.workshopTaskLineItem.count({
        where: { tenant_id: tenantId, workshop_task_id: task.id },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.workshopTask.findFirst({
          where: { tenant_id: tenantId, id: task.id },
          select: { line_items_version: true },
        })
      )?.line_items_version,
    ).toBe(1);

    const secondSearchResponse = await request(app.getHttpServer())
      .get('/api/catalog/external/search')
      .query({
        workshopOrderId: workshopOrder.id,
        taskId: task.id,
        concern: 'PARTS',
        q: 'brake filter',
      })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const secondResponse = await request(app.getHttpServer())
      .post(
        `/api/workshop/orders/${workshopOrder.id}/tasks/${task.id}/lines/from-catalog`,
      )
      .send({ hitToken: secondSearchResponse.body.items[0].hitToken })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(secondResponse.body.lineItemsVersion).toBe(2);
    expect(
      await prisma.workshopTaskLineItem.count({
        where: { tenant_id: tenantId, workshop_task_id: task.id },
      }),
    ).toBe(2);
  });

  it('returns 401 for an invalid catalog hit token', async () => {
    const { workshopOrder, task } = await createResolvedPeugeotOrder();

    await request(app.getHttpServer())
      .post(
        `/api/workshop/orders/${workshopOrder.id}/tasks/${task.id}/lines/from-catalog`,
      )
      .send({ hitToken: 'not-a-catalog-token' })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(401);
  });

  it('returns 409 for wrong-task and cross-tenant catalog hit bindings', async () => {
    const { workshopOrder, task } = await createResolvedPeugeotOrder();
    const searchResponse = await request(app.getHttpServer())
      .get('/api/catalog/external/search')
      .query({
        workshopOrderId: workshopOrder.id,
        taskId: task.id,
        concern: 'PARTS',
        q: 'brake pad',
      })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    const hitToken = searchResponse.body.items[0].hitToken;
    const beforeCount = await prisma.workshopTaskLineItem.count({
      where: { tenant_id: tenantId, workshop_task_id: task.id },
    });

    await request(app.getHttpServer())
      .post(
        `/api/workshop/orders/${workshopOrder.id}/tasks/${task.id}/lines/from-catalog`,
      )
      .send({
        hitToken: resignCatalogHitToken(hitToken, { taskId: randomUUID() }),
      })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(409);

    await request(app.getHttpServer())
      .post(
        `/api/workshop/orders/${workshopOrder.id}/tasks/${task.id}/lines/from-catalog`,
      )
      .send({
        hitToken: resignCatalogHitToken(hitToken, { tenantId: randomUUID() }),
      })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(409);

    expect(
      await prisma.workshopTaskLineItem.count({
        where: { tenant_id: tenantId, workshop_task_id: task.id },
      }),
    ).toBe(beforeCount);
  });

  it('serializes concurrent same-token replay with one line and one version increment', async () => {
    const { workshopOrder, task } = await createResolvedPeugeotOrder();
    const searchResponse = await request(app.getHttpServer())
      .get('/api/catalog/external/search')
      .query({
        workshopOrderId: workshopOrder.id,
        taskId: task.id,
        concern: 'PARTS',
        q: 'concurrent brake',
      })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    const hitToken = searchResponse.body.items[0].hitToken;
    const endpoint = `/api/workshop/orders/${workshopOrder.id}/tasks/${task.id}/lines/from-catalog`;

    const responses = await Promise.all([
      request(app.getHttpServer())
        .post(endpoint)
        .send({ hitToken })
        .set('Authorization', `Bearer ${authToken}`),
      request(app.getHttpServer())
        .post(endpoint)
        .send({ hitToken })
        .set('Authorization', `Bearer ${authToken}`),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 200,
    ]);
    expect(
      await prisma.workshopTaskLineItem.count({
        where: { tenant_id: tenantId, workshop_task_id: task.id },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.workshopTask.findFirst({
          where: { tenant_id: tenantId, id: task.id },
          select: { line_items_version: true },
        })
      )?.line_items_version,
    ).toBe(1);
  });

  it('retries concurrent brand and catalog-item creation across orders', async () => {
    const first = await createResolvedPeugeotOrder();
    const second = await createResolvedPeugeotOrder();
    const searchResponse = await request(app.getHttpServer())
      .get('/api/catalog/external/search')
      .query({
        workshopOrderId: first.workshopOrder.id,
        taskId: first.task.id,
        concern: 'PARTS',
        q: 'race part',
        source: 'AFTERMARKET',
      })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    const firstToken = searchResponse.body.items[0].hitToken;
    const secondToken = resignCatalogHitToken(firstToken, {
      workshopOrderId: second.workshopOrder.id,
      vehicleId: second.vehicle.id,
      taskId: second.task.id,
    });

    const endpoint = (orderId: string, taskId: string) =>
      `/api/workshop/orders/${orderId}/tasks/${taskId}/lines/from-catalog`;
    const responses = await Promise.all([
      request(app.getHttpServer())
        .post(endpoint(first.workshopOrder.id, first.task.id))
        .send({ hitToken: firstToken })
        .set('Authorization', `Bearer ${authToken}`),
      request(app.getHttpServer())
        .post(endpoint(second.workshopOrder.id, second.task.id))
        .send({ hitToken: secondToken })
        .set('Authorization', `Bearer ${authToken}`),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 200,
    ]);

    const claims = verifyCatalogHitPayload(firstToken);
    expect(
      await prisma.brand.count({
        where: { tenant_id: tenantId, normalized_name: 'BOSCH' },
      }),
    ).toBe(1);
    expect(
      await prisma.catalogItem.count({
        where: {
          tenant_id: tenantId,
          source_system: claims.sourceSystem,
          external_article_id: claims.externalId,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.workshopTaskLineItem.count({
        where: {
          tenant_id: tenantId,
          workshop_task_id: { in: [first.task.id, second.task.id] },
        },
      }),
    ).toBe(2);
  });

  it('preserves labor zero rate and null cost while applying AW fallback', async () => {
    const { workshopOrder, task, vehicle } = await createResolvedPeugeotOrder();
    const laborCategory = await prisma.laborCategory.create({
      data: {
        name: `Catalog labor ${Date.now()}`,
        default_hourly_rate: 0,
        default_internal_cost_rate: null,
      },
    });
    const fallbackToken = createLaborHitToken({
      tenantId,
      workshopOrderId: workshopOrder.id,
      vehicleId: vehicle.id,
      taskId: task.id,
      externalId: `labor-fallback-${Date.now()}`,
      plannedHours: null,
    });
    const zeroToken = createLaborHitToken({
      tenantId,
      workshopOrderId: workshopOrder.id,
      vehicleId: vehicle.id,
      taskId: task.id,
      externalId: `labor-zero-${Date.now()}`,
      plannedHours: 0,
    });

    const fallbackResponse = await request(app.getHttpServer())
      .post(
        `/api/workshop/orders/${workshopOrder.id}/tasks/${task.id}/lines/from-catalog`,
      )
      .send({ hitToken: fallbackToken, laborCategoryId: laborCategory.id })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    const zeroResponse = await request(app.getHttpServer())
      .post(
        `/api/workshop/orders/${workshopOrder.id}/tasks/${task.id}/lines/from-catalog`,
      )
      .send({ hitToken: zeroToken, laborCategoryId: laborCategory.id })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(fallbackResponse.body.line).toMatchObject({
      qty: 1.2,
      unitPrice: 0,
      internalCostRate: null,
    });
    expect(zeroResponse.body.line).toMatchObject({
      qty: 0,
      unitPrice: 0,
      internalCostRate: null,
    });
  });

  it('returns fallbackRequired when OEM is empty without confirmFallback', async () => {
    const { workshopOrder, task } = await createResolvedPeugeotOrder();

    const response = await request(app.getHttpServer())
      .get('/api/catalog/external/search')
      .query({
        workshopOrderId: workshopOrder.id,
        taskId: task.id,
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
    const { workshopOrder, task } = await createResolvedPeugeotOrder();

    const response = await request(app.getHttpServer())
      .get('/api/catalog/external/search')
      .query({
        workshopOrderId: workshopOrder.id,
        taskId: task.id,
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
    const { workshopOrder, task } = await createResolvedPeugeotOrder();

    const response = await request(app.getHttpServer())
      .get('/api/catalog/external/search')
      .query({
        workshopOrderId: workshopOrder.id,
        taskId: task.id,
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
    const { workshopOrder, task } = await createResolvedPeugeotOrder();

    const response = await request(app.getHttpServer())
      .get('/api/catalog/external/search')
      .query({
        workshopOrderId: workshopOrder.id,
        taskId: task.id,
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
    const { workshopOrder, task } = await createResolvedPeugeotOrder();
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
        taskId: task.id,
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
    const { workshopOrder, task } = await createResolvedPeugeotOrder();

    await request(app.getHttpServer())
      .get('/api/catalog/external/search')
      .query({
        workshopOrderId: workshopOrder.id,
        taskId: task.id,
        concern: 'PARTS',
        q: 'brake',
      })
      .set('Authorization', `Bearer ${techAuthToken}`)
      .expect(403);
  });

  it('blocks TECH sessions from adding catalog lines', async () => {
    const { workshopOrder, task } = await createResolvedPeugeotOrder();

    await request(app.getHttpServer())
      .post(
        `/api/workshop/orders/${workshopOrder.id}/tasks/${task.id}/lines/from-catalog`,
      )
      .send({ hitToken: 'not-used-by-tech' })
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
