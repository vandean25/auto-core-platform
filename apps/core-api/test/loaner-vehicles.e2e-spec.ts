import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  LOANER_BOOKING_OVERLAP,
  LOANER_ODOMETER_IN_INVALID,
} from '../src/loaner-vehicles/loaner.constants.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('Loaner vehicles (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let authService: AuthService;
  let tenant: TestTenantResult;
  let prisma: PrismaService;
  let authToken: string;
  let siteId: string;
  let customerId: string;
  let loanerVehicleId: string;
  let otherSiteId: string;

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
    tenant = await createTestTenant(basePrisma, 'loaner-vehicles');
    prisma = createTenantAwarePrisma(basePrisma, tenant.tenantId);
    authToken = createTestAuthToken(authService, tenant);
    siteId = await resolveTestMainSiteId(basePrisma, tenant.tenantId);

    const customer = await prisma.customer.create({
      data: {
        first_name: 'pilot',
        last_name: 'customer',
        type: 'PRIVATE',
      },
    });
    customerId = customer.id;

    const loanerVehicleRecord = await prisma.vehicle.create({
      data: {
        customer_id: customerId,
        make: 'Skoda',
        model: 'Octavia',
        year: 2021,
        plate: 'W-LOANER1',
        vin: 'LOANERVIN00000001',
      },
    });

    const fleetResponse = await request(app.getHttpServer())
      .post('/api/workshop/loaner-vehicles')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        vehicleId: loanerVehicleRecord.id,
        displayName: 'Pool Octavia',
      })
      .expect(201);

    loanerVehicleId = fleetResponse.body.id;

    const legalEntity = await prisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId },
    });
    const otherSite = await prisma.site.create({
      data: {
        tenant_id: tenant.tenantId,
        legal_entity_id: legalEntity.id,
        code: 'WEST',
        name: 'West site',
        timezone: 'Europe/Vienna',
        slot_minutes: 30,
        holiday_country_iso: 'AT',
        is_active: true,
      },
    });
    otherSiteId = otherSite.id;
  });

  afterEach(async () => {
    if (tenant?.tenantId) {
      await cleanupTestTenantGraph(basePrisma, tenant.tenantId).catch(
        () => undefined,
      );
    }
  });

  afterAll(async () => {
    await teardownTestApp(app, basePrisma);
  });

  function bookingPayload(overrides: Record<string, unknown> = {}) {
    return {
      loanerVehicleId,
      customerId,
      plannedFrom: '2026-10-10T08:00:00.000Z',
      plannedTo: '2026-10-12T18:00:00.000Z',
      ...overrides,
    };
  }

  it('returns 409 for overlapping concurrent booking creates', async () => {
    const responses = await Promise.all([
      request(app.getHttpServer())
        .post('/api/workshop/loaner-bookings')
        .set('Authorization', `Bearer ${authToken}`)
        .send(bookingPayload()),
      request(app.getHttpServer())
        .post('/api/workshop/loaner-bookings')
        .set('Authorization', `Bearer ${authToken}`)
        .send(bookingPayload()),
    ]);

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 409]);
    const conflict = responses.find((response) => response.status === 409);
    expect(
      conflict?.body.code ?? conflict?.body.message,
    ).toEqual(
      expect.stringMatching(new RegExp(LOANER_BOOKING_OVERLAP)),
    );

    const count = await prisma.loanerBooking.count({
      where: { tenant_id: tenant.tenantId, loaner_vehicle_id: loanerVehicleId },
    });
    expect(count).toBe(1);
  });

  it('rejects a workshop order from another site', async () => {
    const foreignCustomer = await prisma.customer.create({
      data: {
        first_name: 'pilot',
        last_name: 'customer',
        type: 'PRIVATE',
      },
    });
    const foreignVehicle = await prisma.vehicle.create({
      data: {
        customer_id: foreignCustomer.id,
        make: 'Ford',
        model: 'Focus',
        year: 2019,
        plate: 'W-OTHER1',
      },
    });
    const foreignOrder = await prisma.workshopOrder.create({
      data: {
        site_id: otherSiteId,
        customer_id: foreignCustomer.id,
        vehicle_id: foreignVehicle.id,
        order_number: 'WO-LOANER-OTHER',
        odometer: 1000,
        fuel_level: 50,
      },
    });

    await request(app.getHttpServer())
      .post('/api/workshop/loaner-bookings')
      .set('Authorization', `Bearer ${authToken}`)
      .send(
        bookingPayload({
          workshopOrderId: foreignOrder.id,
        }),
      )
      .expect(404);
  });

  it('rejects a customer from another tenant', async () => {
    const otherTenant = await createTestTenant(basePrisma, 'loaner-other');
    const otherPrisma = createTenantAwarePrisma(basePrisma, otherTenant.tenantId);
    const foreignCustomer = await otherPrisma.customer.create({
      data: {
        first_name: 'pilot',
        last_name: 'customer',
        type: 'PRIVATE',
      },
    });

    await request(app.getHttpServer())
      .post('/api/workshop/loaner-bookings')
      .set('Authorization', `Bearer ${authToken}`)
      .send(
        bookingPayload({
          customerId: foreignCustomer.id,
        }),
      )
      .expect(404);

    await cleanupTestTenantGraph(basePrisma, otherTenant.tenantId).catch(
      () => undefined,
    );
  });

  it('validates return odometer against handover reading', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/workshop/loaner-bookings')
      .set('Authorization', `Bearer ${authToken}`)
      .send(bookingPayload())
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/workshop/loaner-bookings/${created.body.id}/hand-over`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        odometerOut: 50000,
        fuelOut: 80,
        driverLicenceChecked: true,
      })
      .expect(201);

    const invalidReturn = await request(app.getHttpServer())
      .post(`/api/workshop/loaner-bookings/${created.body.id}/return`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        odometerIn: 49999,
        fuelIn: 70,
      })
      .expect(400);

    expect(
      invalidReturn.body.code ?? invalidReturn.body.message,
    ).toEqual(
      expect.stringMatching(new RegExp(LOANER_ODOMETER_IN_INVALID)),
    );

    await request(app.getHttpServer())
      .post(`/api/workshop/loaner-bookings/${created.body.id}/return`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        odometerIn: 50100,
        fuelIn: 70,
      })
      .expect(201);
  });
});
