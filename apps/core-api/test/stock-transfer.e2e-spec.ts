import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SiteService } from '../src/site/site.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

/**
 * AUT-466: same-GmbH stock transfers between the MAIN and GRZ sites used to
 * return HTTP 500 from POST /api/stock-transfers. These e2e cases run the
 * real Nest pipeline and Postgres (no Prisma mocks), in both directions and
 * with and without an optional source bin.
 */
describe('Stock transfers MAIN <-> GRZ (AUT-466, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let siteService: SiteService;

  let tenant: TestTenantResult;
  let mainSiteId: string;
  let grzSiteId: string;
  let mainBinId: string;
  let grzBinId: string;
  let catalogItemId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    authService = app.get<AuthService>(AuthService);
    siteService = app.get<SiteService>(SiteService);
  });

  beforeEach(async () => {
    tenant = await createTestTenant(prisma, 'aut466');
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);

    const user = await tenantPrisma.user.findFirstOrThrow({
      where: { email: tenant.email },
      select: { id: true },
    });
    const main = await tenantPrisma.site.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId, code: 'MAIN' },
      select: { id: true, legal_entity_id: true },
    });
    mainSiteId = main.id;

    // GRZ lives under the same legal entity as MAIN (same GmbH).
    const grz = await runWithTenantContext(tenant.tenantId, () =>
      siteService.createSite({
        legalEntityId: main.legal_entity_id,
        code: 'GRZ',
        name: 'Graz Workshop',
      }),
    );
    grzSiteId = grz.id;
    await runWithTenantContext(tenant.tenantId, () =>
      siteService.addSiteMembership(grzSiteId, { userId: user.id }),
    );

    const mainBin = await tenantPrisma.storageLocation.create({
      data: {
        tenant_id: tenant.tenantId,
        site_id: mainSiteId,
        code: 'BIN-A1',
        name: 'Bin A1',
        type: 'bin',
      },
      select: { id: true },
    });
    mainBinId = mainBin.id;

    const grzBin = await tenantPrisma.storageLocation.create({
      data: {
        tenant_id: tenant.tenantId,
        site_id: grzSiteId,
        code: 'BIN-G1',
        name: 'Bin G1',
        type: 'bin',
      },
      select: { id: true },
    });
    grzBinId = grzBin.id;

    const item = await tenantPrisma.catalogItem.create({
      data: {
        tenant_id: tenant.tenantId,
        sku: `AUT466-${Date.now()}`,
        name: 'Brake pad set',
        retail_price: 49.9,
        cost_price: 20,
      },
      select: { id: true },
    });
    catalogItemId = item.id;
  });

  afterEach(async () => {
    await cleanupTestTenantGraph(prisma, tenant.tenantId).catch(
      () => undefined,
    );
  });

  afterAll(async () => {
    await teardownTestApp(app, prisma);
  });

  const token = () => createTestAuthToken(authService, tenant);

  function postTransfer(body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/api/stock-transfers')
      .set('Authorization', `Bearer ${token()}`)
      .send(body);
  }

  function postAction(
    transferId: string,
    action: 'approve' | 'ship' | 'receive',
    body: Record<string, unknown>,
  ) {
    return request(app.getHttpServer())
      .post(`/api/stock-transfers/${transferId}/${action}`)
      .set('Authorization', `Bearer ${token()}`)
      .send(body);
  }

  async function seedBinStock(siteId: string, locationId: string, qty: number) {
    await createTenantAwarePrisma(prisma, tenant.tenantId).inventoryStock.create({
      data: {
        tenant_id: tenant.tenantId,
        site_id: siteId,
        catalog_item_id: catalogItemId,
        location_id: locationId,
        quantity_on_hand: qty,
      },
    });
  }

  async function onHandAt(locationId: string): Promise<number> {
    const stock = await createTenantAwarePrisma(
      prisma,
      tenant.tenantId,
    ).inventoryStock.findFirst({
      where: { catalog_item_id: catalogItemId, location_id: locationId },
      select: { quantity_on_hand: true },
    });
    return Number(stock?.quantity_on_hand ?? 0);
  }

  describe('create (POST /api/stock-transfers)', () => {
    it('creates a MAIN -> GRZ request without a source bin (201, not 500)', async () => {
      const res = await postTransfer({
        fromSiteId: mainSiteId,
        toSiteId: grzSiteId,
        lines: [{ catalogItemId, requestedQty: 2 }],
      }).expect(201);

      expect(res.body).toMatchObject({
        fromSiteId: mainSiteId,
        toSiteId: grzSiteId,
        status: 'REQUESTED',
        version: 1,
      });
      expect(res.body.transferNumber).toMatch(/^TR-\d{4}-\d{4}$/);
      expect(res.body.lines).toHaveLength(1);
      expect(res.body.lines[0]).toMatchObject({
        catalogItemId,
        requestedQty: '2',
        sourceLocationId: null,
      });
    });

    it('creates a MAIN -> GRZ request with a source bin on MAIN (201)', async () => {
      const res = await postTransfer({
        fromSiteId: mainSiteId,
        toSiteId: grzSiteId,
        lines: [
          { catalogItemId, requestedQty: 1, sourceLocationId: mainBinId },
        ],
      }).expect(201);

      expect(res.body.lines[0].sourceLocationId).toBe(mainBinId);
    });

    it('creates a GRZ -> MAIN request without a source bin (201, not 500)', async () => {
      const res = await postTransfer({
        fromSiteId: grzSiteId,
        toSiteId: mainSiteId,
        lines: [{ catalogItemId, requestedQty: 3 }],
      }).expect(201);

      expect(res.body).toMatchObject({
        fromSiteId: grzSiteId,
        toSiteId: mainSiteId,
        status: 'REQUESTED',
      });
    });

    it('creates a GRZ -> MAIN request with a source bin on GRZ (201)', async () => {
      const res = await postTransfer({
        fromSiteId: grzSiteId,
        toSiteId: mainSiteId,
        lines: [
          { catalogItemId, requestedQty: 1, sourceLocationId: grzBinId },
        ],
      }).expect(201);

      expect(res.body.lines[0].sourceLocationId).toBe(grzBinId);
    });

    it('lists the MAIN <-> GRZ requests the caller just created', async () => {
      const created = await postTransfer({
        fromSiteId: mainSiteId,
        toSiteId: grzSiteId,
        lines: [{ catalogItemId, requestedQty: 1 }],
      }).expect(201);

      const list = await request(app.getHttpServer())
        .get('/api/stock-transfers')
        .set('Authorization', `Bearer ${token()}`)
        .expect(200);

      expect(list.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: created.body.id,
            transferNumber: created.body.transferNumber,
            fromSiteId: mainSiteId,
            fromSiteName: expect.any(String),
            toSiteId: grzSiteId,
            toSiteName: 'Graz Workshop',
          }),
        ]),
      );
    });

    it('rejects a source bin that belongs to the other site with 422 (not 500)', async () => {
      const res = await postTransfer({
        fromSiteId: mainSiteId,
        toSiteId: grzSiteId,
        lines: [
          { catalogItemId, requestedQty: 1, sourceLocationId: grzBinId },
        ],
      }).expect(422);

      expect(res.body.message).toMatch(
        /Source location not found on the from-site/,
      );
    });
  });

  describe('lifecycle (approve -> ship -> receive)', () => {
    it('MAIN -> GRZ: ships from the MAIN bin and receives into the GRZ bin', async () => {
      await seedBinStock(mainSiteId, mainBinId, 5);

      const created = await postTransfer({
        fromSiteId: mainSiteId,
        toSiteId: grzSiteId,
        lines: [
          { catalogItemId, requestedQty: 2, sourceLocationId: mainBinId },
        ],
      }).expect(201);
      const transferId = created.body.id;
      const lineId = created.body.lines[0].id;

      await postAction(transferId, 'approve', { expectedVersion: 1 }).expect(
        201,
      );
      await postAction(transferId, 'ship', {
        expectedVersion: 2,
        lines: [{ id: lineId }],
      }).expect(201);
      const received = await postAction(transferId, 'receive', {
        expectedVersion: 3,
        idempotencyKey: 'aut466-main-grz-1',
        lines: [{ id: lineId, receiveQty: 2, destLocationId: grzBinId }],
      }).expect(200);

      expect(received.body.status).toBe('COMPLETED');
      expect(await onHandAt(mainBinId)).toBe(3);
      expect(await onHandAt(grzBinId)).toBe(2);
    });

    it('GRZ -> MAIN: source bin chosen at ship time, received into the MAIN bin', async () => {
      await seedBinStock(grzSiteId, grzBinId, 4);

      const created = await postTransfer({
        fromSiteId: grzSiteId,
        toSiteId: mainSiteId,
        lines: [{ catalogItemId, requestedQty: 3 }],
      }).expect(201);
      const transferId = created.body.id;
      const lineId = created.body.lines[0].id;

      await postAction(transferId, 'approve', { expectedVersion: 1 }).expect(
        201,
      );
      await postAction(transferId, 'ship', {
        expectedVersion: 2,
        lines: [{ id: lineId, sourceLocationId: grzBinId }],
      }).expect(201);
      const received = await postAction(transferId, 'receive', {
        expectedVersion: 3,
        idempotencyKey: 'aut466-grz-main-1',
        lines: [{ id: lineId, receiveQty: 3, destLocationId: mainBinId }],
      }).expect(200);

      expect(received.body.status).toBe('COMPLETED');
      expect(await onHandAt(grzBinId)).toBe(1);
      expect(await onHandAt(mainBinId)).toBe(3);
    });
  });
});
