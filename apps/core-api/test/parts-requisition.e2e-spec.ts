import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createGlobalValidationPipe } from '../src/common';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
  seedTestTenantMember,
  type TestTenantResult,
} from './tenant-test-utils';
import { teardownTestApp } from './test-lifecycle';

type ReservationFixture = {
  tenant: TestTenantResult;
  prisma: PrismaService;
  siteId: string;
  authToken: string;
  orderId: string;
  lineId: string;
  stockId: string;
  sourceLocationId: string;
};

describe('Parts requisition persistence and site authorization (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let authService: AuthService;
  let fixture: ReservationFixture;
  const createdTenants: TestTenantResult[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    basePrisma = app.get(PrismaService);
    authService = app.get(AuthService);
  });

  beforeEach(async () => {
    fixture = await createReservationFixture('parts-reservation');
    createdTenants.push(fixture.tenant);
  });

  afterEach(async () => {
    while (createdTenants.length > 0) {
      const tenant = createdTenants.pop();
      if (tenant) {
        await cleanupTestTenantGraph(basePrisma, tenant.tenantId).catch(
          () => undefined,
        );
      }
    }
  });

  afterAll(async () => {
    await teardownTestApp(app, basePrisma);
  });

  it('serializes last-unit reservations with one success and one conflict', async () => {
    const responses = await Promise.all([
      postReservation(fixture.authToken, fixture.lineId, fixture.sourceLocationId),
      postReservation(fixture.authToken, fixture.lineId, fixture.sourceLocationId),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      201,
      409,
    ]);

    const stock = await fixture.prisma.inventoryStock.findFirstOrThrow({
      where: { id: fixture.stockId },
    });
    expect(stock.quantity_reserved).toEqual(new Prisma.Decimal('1'));

    const reservationCount = await fixture.prisma.partsReservation.count({
      where: { workshop_task_line_item_id: fixture.lineId },
    });
    expect(reservationCount).toBe(1);

    const task = await fixture.prisma.workshopTask.findFirstOrThrow({
      where: { workshop_order_id: fixture.orderId },
    });
    expect(task.line_items_version).toBe(1);
  });

  it('rejects TECH reservation access before any database mutation', async () => {
    const techIdentity = await createTechIdentity(fixture);

    const response = await postReservation(
      techIdentity.authToken,
      fixture.lineId,
      fixture.sourceLocationId,
    );

    expect(response.status).toBe(403);
    await expectReservationState(fixture, {
      quantityReserved: '0',
      reservationCount: 0,
      lineItemsVersion: 0,
    });
  });

  it('rejects a source location from another site or tenant', async () => {
    const otherSiteLocationId = await createOtherSiteBin(fixture);
    const otherTenantFixture = await createReservationFixture(
      'parts-reservation-other-tenant',
    );
    createdTenants.push(otherTenantFixture.tenant);

    const otherSiteResponse = await postReservation(
      fixture.authToken,
      fixture.lineId,
      otherSiteLocationId,
    );
    const otherTenantResponse = await postReservation(
      fixture.authToken,
      fixture.lineId,
      otherTenantFixture.sourceLocationId,
    );

    expect(otherSiteResponse.status).toBe(422);
    expect(otherTenantResponse.status).toBe(422);
    await expectReservationState(fixture, {
      quantityReserved: '0',
      reservationCount: 0,
      lineItemsVersion: 0,
    });
  });

  it('rejects a non-bin source before reserving ATP', async () => {
    const nonBinFixture = await createReservationFixture(
      'parts-reservation-non-bin',
      'warehouse',
    );
    createdTenants.push(nonBinFixture.tenant);

    const response = await postReservation(
      nonBinFixture.authToken,
      nonBinFixture.lineId,
      nonBinFixture.sourceLocationId,
    );

    expect(response.status).toBe(422);
    await expectReservationState(nonBinFixture, {
      quantityReserved: '0',
      reservationCount: 0,
      lineItemsVersion: 0,
    });
  });

  it('reserves an unstaged site-owned order when the source bin matches its site', async () => {
    const unstagedFixture = await createReservationFixture(
      'parts-reservation-unstaged',
      'bin',
      false,
    );
    createdTenants.push(unstagedFixture.tenant);

    const reservationResponse = await postReservation(
      unstagedFixture.authToken,
      unstagedFixture.lineId,
      unstagedFixture.sourceLocationId,
    );
    expect(reservationResponse.status).toBe(201);

    await expectReservationState(unstagedFixture, {
      quantityReserved: '1',
      reservationCount: 1,
      lineItemsVersion: 1,
    });
  });

  it('discovers shortages for an unstaged site-owned order', async () => {
    const unstagedFixture = await createReservationFixture(
      'parts-shortage-unstaged',
      'bin',
      false,
    );
    createdTenants.push(unstagedFixture.tenant);

    const shortagesResponse = await request(app.getHttpServer())
      .get('/api/parts-requisitions/shortages')
      .set('Authorization', `Bearer ${unstagedFixture.authToken}`)
      .expect(200);

    expect(shortagesResponse.body.data).toEqual([
      expect.objectContaining({
        workshopOrderId: unstagedFixture.orderId,
        workshopTaskLineItemId: unstagedFixture.lineId,
        siteId: unstagedFixture.siteId,
        shortageQuantity: '1',
      }),
    ]);
  });

  it('fails closed for a legacy order without persisted site ownership', async () => {
    const legacyFixture = await createReservationFixture(
      'parts-reservation-legacy-null-site',
      'bin',
      false,
      false,
    );
    createdTenants.push(legacyFixture.tenant);

    const reservationResponse = await postReservation(
      legacyFixture.authToken,
      legacyFixture.lineId,
      legacyFixture.sourceLocationId,
    );
    expect(reservationResponse.status).toBe(422);

    const shortagesResponse = await request(app.getHttpServer())
      .get('/api/parts-requisitions/shortages')
      .set('Authorization', `Bearer ${legacyFixture.authToken}`)
      .expect(200);

    expect(shortagesResponse.body.data).toEqual([]);
    await expectReservationState(legacyFixture, {
      quantityReserved: '0',
      reservationCount: 0,
      lineItemsVersion: 0,
    });
  });

  async function createReservationFixture(
    prefix: string,
    sourceType: 'bin' | 'warehouse' = 'bin',
    staged = true,
    siteOwned = true,
  ): Promise<ReservationFixture> {
    const tenant = await createTestTenant(basePrisma, prefix);
    const prisma = createTenantAwarePrisma(basePrisma, tenant.tenantId);
    const site = await prisma.site.findFirstOrThrow({
      where: { code: 'MAIN' },
    });
    const sourceLocation = await prisma.storageLocation.create({
      data: {
        site_id: site.id,
        code: `${prefix}-SOURCE-${Date.now()}`,
        name: `${sourceType} source`,
        type: sourceType,
      },
    });
    const stagingLocation = await prisma.storageLocation.create({
      data: {
        site_id: site.id,
        code: `${prefix}-STAGING-${Date.now()}`,
        name: 'Staging tote',
        type: 'staging_tote',
      },
    });
    const catalogItem = await prisma.catalogItem.create({
      data: {
        sku: `${prefix}-SKU-${Date.now()}`,
        name: 'Brake pad',
        cost_price: 10,
        retail_price: 20,
      },
    });
    const vehicle = await prisma.vehicle.create({
      data: {
        make: 'Toyota',
        model: 'Corolla',
        year: 2020,
      },
    });
    const order = await prisma.workshopOrder.create({
      data: {
        order_number: `${prefix}-ORDER-${Date.now()}`,
        site_id: siteOwned ? site.id : null,
        vehicle_id: vehicle.id,
        staging_location_id: staged ? stagingLocation.id : null,
        status: 'IN_PROGRESS',
        odometer: 50000,
        fuel_level: 75,
      },
    });
    const task = await prisma.workshopTask.create({
      data: {
        workshop_order_id: order.id,
        title: 'Replace brake pads',
      },
    });
    const line = await prisma.workshopTaskLineItem.create({
      data: {
        workshop_task_id: task.id,
        type: 'PART',
        part_execution_status: 'PENDING_PICK',
        item_no: catalogItem.sku,
        description: catalogItem.name,
        quantity: 1,
        unit_price: 20,
        catalog_item_id: catalogItem.id,
      },
    });
    const stock = await prisma.inventoryStock.create({
      data: {
        catalog_item_id: catalogItem.id,
        location_id: sourceLocation.id,
        quantity_on_hand: 1,
      },
    });

    return {
      tenant,
      prisma,
      siteId: site.id,
      authToken: createTestAuthToken(authService, tenant),
      orderId: order.id,
      lineId: line.id,
      stockId: stock.id,
      sourceLocationId: sourceLocation.id,
    };
  }

  async function createOtherSiteBin(
    reservationFixture: ReservationFixture,
  ): Promise<string> {
    const legalEntity = await reservationFixture.prisma.legalEntity.findFirstOrThrow();
    const otherSite = await reservationFixture.prisma.site.create({
      data: {
        legal_entity_id: legalEntity.id,
        code: `OTHER-${Date.now()}`,
        name: 'Other site',
        timezone: 'Europe/Vienna',
        slot_minutes: 30,
        holiday_country_iso: 'AT',
      },
    });
    const location = await reservationFixture.prisma.storageLocation.create({
      data: {
        site_id: otherSite.id,
        code: `OTHER-BIN-${Date.now()}`,
        name: 'Other site bin',
        type: 'bin',
      },
    });
    return location.id;
  }

  async function createTechIdentity(reservationFixture: ReservationFixture) {
    const firebaseUid = `e2e-parts-tech-${Date.now()}`;
    const user = await basePrisma.user.create({
      data: {
        firebaseUid,
        email: `${firebaseUid}@example.com`,
      },
    });
    await seedTestTenantMember(basePrisma, {
      tenantId: reservationFixture.tenant.tenantId,
      userId: user.id,
      role: 'TECH',
    });
    await runWithTenantContext(
      reservationFixture.tenant.tenantId,
      async () => {
        await basePrisma.siteMembership.create({
          data: {
            tenant_id: reservationFixture.tenant.tenantId,
            user_id: user.id,
            site_id: reservationFixture.siteId,
            is_active: true,
          },
        });
        await basePrisma.user.update({
          where: { id: user.id },
          data: { active_site_id: reservationFixture.siteId },
        });
      },
    );

    return {
      authToken: authService.createTestToken({
        sub: firebaseUid,
        email: user.email,
        tenantId: reservationFixture.tenant.tenantId,
        role: 'TECH',
      }),
    };
  }

  async function expectReservationState(
    reservationFixture: ReservationFixture,
    expected: {
      quantityReserved: string;
      reservationCount: number;
      lineItemsVersion: number;
    },
  ): Promise<void> {
    const stock = await reservationFixture.prisma.inventoryStock.findFirstOrThrow({
      where: { id: reservationFixture.stockId },
    });
    expect(stock.quantity_reserved).toEqual(
      new Prisma.Decimal(expected.quantityReserved),
    );

    const reservationCount = await reservationFixture.prisma.partsReservation.count({
      where: { workshop_task_line_item_id: reservationFixture.lineId },
    });
    expect(reservationCount).toBe(expected.reservationCount);

    const task = await reservationFixture.prisma.workshopTask.findFirstOrThrow({
      where: { workshop_order_id: reservationFixture.orderId },
    });
    expect(task.line_items_version).toBe(expected.lineItemsVersion);
  }

  async function postReservation(
    authToken: string,
    lineId: string,
    locationId: string,
  ) {
    return request(app.getHttpServer())
      .post('/api/parts-reservations')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        workshopTaskLineItemId: lineId,
        quantity: 1,
        locationId,
      });
  }
});
