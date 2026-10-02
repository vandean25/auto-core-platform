import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  LOANER_ALREADY_RETURNED,
  LOANER_BOOKING_OVERLAP,
  LOANER_FLEET_DELETE_BLOCKED,
  LOANER_FORBIDDEN_WRITE,
  LOANER_ODOMETER_IN_INVALID,
  LOANER_RETURN_BEFORE_HANDOVER,
  LOANER_VEHICLE_ON_LOAN,
} from '../src/loaner-vehicles/loaner.constants.js';
import { setLoanerNowForTests } from '../src/loaner-vehicles/loaner-clock.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
  runWithTenantContext,
  seedTestEmployee,
  seedTestTenantMember,
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
  let advisorToken: string;
  let salesToken: string;
  let mechanicToken: string;
  let siteId: string;
  let customerId: string;
  let loanerVehicleId: string;
  let otherSiteId: string;
  let adminUserId: string;

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
    setLoanerNowForTests(undefined);
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

    await runWithTenantContext(tenant.tenantId, async () => {
      const adminUser = await basePrisma.user.findFirstOrThrow({
        where: { firebaseUid: tenant.firebaseUid },
        select: { id: true },
      });
      adminUserId = adminUser.id;

      await prisma.siteMembership.create({
        data: {
          tenant_id: tenant.tenantId,
          user_id: adminUserId,
          site_id: otherSiteId,
          is_active: true,
        },
      });

      const advisorUid = `loaner-advisor-${Date.now()}`;
      const advisorUser = await basePrisma.user.create({
        data: {
          firebaseUid: advisorUid,
          email: `loaner-advisor-${Date.now()}@test.local`,
        },
      });
      await seedTestTenantMember(basePrisma, {
        tenantId: tenant.tenantId,
        userId: advisorUser.id,
        role: 'SALES',
      });
      await seedTestEmployee(basePrisma, {
        tenantId: tenant.tenantId,
        name: 'Loaner Advisor',
        role: 'SERVICE_ADVISOR',
        userId: advisorUser.id,
      });
      await prisma.siteMembership.create({
        data: {
          tenant_id: tenant.tenantId,
          user_id: advisorUser.id,
          site_id: siteId,
          is_active: true,
        },
      });
      await basePrisma.user.update({
        where: { id: advisorUser.id },
        data: { active_site_id: siteId },
      });
      advisorToken = authService.createTestToken({
        sub: advisorUid,
        email: advisorUser.email,
        tenantId: tenant.tenantId,
        role: 'SALES',
      });

      const salesUid = `loaner-sales-${Date.now()}`;
      const salesUser = await basePrisma.user.create({
        data: {
          firebaseUid: salesUid,
          email: `loaner-sales-${Date.now()}@test.local`,
        },
      });
      await seedTestTenantMember(basePrisma, {
        tenantId: tenant.tenantId,
        userId: salesUser.id,
        role: 'SALES',
      });
      salesToken = authService.createTestToken({
        sub: salesUid,
        email: salesUser.email,
        tenantId: tenant.tenantId,
        role: 'SALES',
      });

      const mechanicUid = `loaner-mech-${Date.now()}`;
      const mechanicUser = await basePrisma.user.create({
        data: {
          firebaseUid: mechanicUid,
          email: `loaner-mech-${Date.now()}@test.local`,
        },
      });
      await seedTestTenantMember(basePrisma, {
        tenantId: tenant.tenantId,
        userId: mechanicUser.id,
        role: 'TECH',
      });
      await seedTestEmployee(basePrisma, {
        tenantId: tenant.tenantId,
        name: 'Loaner Mechanic',
        role: 'MECHANIC',
        userId: mechanicUser.id,
      });
      mechanicToken = authService.createTestToken({
        sub: mechanicUid,
        email: mechanicUser.email,
        tenantId: tenant.tenantId,
        role: 'TECH',
      });
    });
  });

  afterEach(async () => {
    setLoanerNowForTests(undefined);
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

  async function createReservedBooking(
    overrides: Record<string, unknown> = {},
  ) {
    const response = await request(app.getHttpServer())
      .post('/api/workshop/loaner-bookings')
      .set('Authorization', `Bearer ${authToken}`)
      .send(bookingPayload(overrides))
      .expect(201);
    return response.body;
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

  it('rejects a workshop order from another tenant', async () => {
    const otherTenant = await createTestTenant(basePrisma, 'loaner-order-x');
    const otherPrisma = createTenantAwarePrisma(basePrisma, otherTenant.tenantId);
    const otherSiteId = await resolveTestMainSiteId(basePrisma, otherTenant.tenantId);
    const foreignCustomer = await otherPrisma.customer.create({
      data: {
        first_name: 'pilot',
        last_name: 'customer',
        type: 'PRIVATE',
      },
    });
    const foreignVehicle = await otherPrisma.vehicle.create({
      data: {
        customer_id: foreignCustomer.id,
        make: 'Seat',
        model: 'Leon',
        year: 2020,
        plate: 'X-TENANT',
      },
    });
    const foreignOrder = await otherPrisma.workshopOrder.create({
      data: {
        site_id: otherSiteId,
        customer_id: foreignCustomer.id,
        vehicle_id: foreignVehicle.id,
        order_number: 'WO-FOREIGN-TENANT',
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

    const created = await createReservedBooking();
    await request(app.getHttpServer())
      .patch(`/api/workshop/loaner-bookings/${created.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ workshopOrderId: foreignOrder.id })
      .expect(404);

    await cleanupTestTenantGraph(basePrisma, otherTenant.tenantId).catch(
      () => undefined,
    );
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
    const created = await createReservedBooking();

    await request(app.getHttpServer())
      .post(`/api/workshop/loaner-bookings/${created.id}/hand-over`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        odometerOut: 50000,
        fuelOut: 80,
        driverLicenceChecked: true,
      })
      .expect(201);

    const invalidReturn = await request(app.getHttpServer())
      .post(`/api/workshop/loaner-bookings/${created.id}/return`)
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
      .post(`/api/workshop/loaner-bookings/${created.id}/return`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        odometerIn: 50100,
        fuelIn: 70,
      })
      .expect(201);
  });

  it('allows SERVICE_ADVISOR write and blocks SALES and MECHANIC', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/workshop/loaner-bookings')
      .set('Authorization', `Bearer ${advisorToken}`)
      .send(bookingPayload())
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/workshop/loaner-bookings')
      .set('Authorization', `Bearer ${salesToken}`)
      .send(bookingPayload())
      .expect(403)
      .expect((res) => {
        expect(res.body.code ?? res.body.message).toEqual(
          expect.stringMatching(new RegExp(LOANER_FORBIDDEN_WRITE)),
        );
      });

    await request(app.getHttpServer())
      .post(`/api/workshop/loaner-bookings/${created.id}/cancel`)
      .set('Authorization', `Bearer ${mechanicToken}`)
      .expect(403);
  });

  it('rejects return before handover', async () => {
    const created = await createReservedBooking();
    const response = await request(app.getHttpServer())
      .post(`/api/workshop/loaner-bookings/${created.id}/return`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ odometerIn: 1000, fuelIn: 50 })
      .expect(400);

    expect(response.body.code ?? response.body.message).toEqual(
      expect.stringMatching(new RegExp(LOANER_RETURN_BEFORE_HANDOVER)),
    );
  });

  it('rejects double return', async () => {
    const created = await createReservedBooking();
    await request(app.getHttpServer())
      .post(`/api/workshop/loaner-bookings/${created.id}/hand-over`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        odometerOut: 1000,
        fuelOut: 50,
        driverLicenceChecked: true,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/workshop/loaner-bookings/${created.id}/return`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ odometerIn: 1100, fuelIn: 40 })
      .expect(201);

    const secondReturn = await request(app.getHttpServer())
      .post(`/api/workshop/loaner-bookings/${created.id}/return`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ odometerIn: 1200, fuelIn: 30 })
      .expect(400);

    expect(secondReturn.body.code ?? secondReturn.body.message).toEqual(
      expect.stringMatching(new RegExp(LOANER_ALREADY_RETURNED)),
    );
  });

  it('handles parallel double return with a single success', async () => {
    const created = await createReservedBooking();
    await request(app.getHttpServer())
      .post(`/api/workshop/loaner-bookings/${created.id}/hand-over`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        odometerOut: 2000,
        fuelOut: 60,
        driverLicenceChecked: true,
      })
      .expect(201);

    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/workshop/loaner-bookings/${created.id}/return`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ odometerIn: 2100, fuelIn: 50 }),
      request(app.getHttpServer())
        .post(`/api/workshop/loaner-bookings/${created.id}/return`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ odometerIn: 2100, fuelIn: 50 }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 400]);
    const failed = first.status === 400 ? first : second;
    expect(failed.body.code ?? failed.body.message).toEqual(
      expect.stringMatching(new RegExp(LOANER_ALREADY_RETURNED)),
    );
  });

  it('rejects fleet create with a vehicle from another tenant', async () => {
    const otherTenant = await createTestTenant(basePrisma, 'loaner-fleet-x');
    const otherPrisma = createTenantAwarePrisma(basePrisma, otherTenant.tenantId);
    const foreignVehicle = await otherPrisma.vehicle.create({
      data: {
        make: 'Audi',
        model: 'A3',
        year: 2020,
        plate: 'X-FOREIGN',
      },
    });

    await request(app.getHttpServer())
      .post('/api/workshop/loaner-vehicles')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        vehicleId: foreignVehicle.id,
        displayName: 'Foreign fleet',
      })
      .expect(404);

    await cleanupTestTenantGraph(basePrisma, otherTenant.tenantId).catch(
      () => undefined,
    );
  });

  it('returns 404 when fetching a booking from another site context', async () => {
    const created = await createReservedBooking();
    await runWithTenantContext(tenant.tenantId, async () => {
      await basePrisma.user.update({
        where: { id: adminUserId },
        data: { active_site_id: otherSiteId },
      });
    });

    await request(app.getHttpServer())
      .get(`/api/workshop/loaner-bookings/${created.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(404);

    await runWithTenantContext(tenant.tenantId, async () => {
      await basePrisma.user.update({
        where: { id: adminUserId },
        data: { active_site_id: siteId },
      });
    });
  });

  it('lists overdue bookings using injected clock via asOf', async () => {
    setLoanerNowForTests(new Date('2026-10-15T12:00:00.000Z'));
    const overdueBooking = await createReservedBooking({
      plannedFrom: '2026-10-01T08:00:00.000Z',
      plannedTo: '2026-10-05T18:00:00.000Z',
    });
    await request(app.getHttpServer())
      .post(`/api/workshop/loaner-bookings/${overdueBooking.id}/hand-over`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        odometerOut: 1000,
        fuelOut: 50,
        driverLicenceChecked: true,
      })
      .expect(201);

    const notYetDue = await createReservedBooking({
      plannedFrom: '2026-11-01T08:00:00.000Z',
      plannedTo: '2026-11-10T18:00:00.000Z',
    });

    const boundaryBooking = await createReservedBooking({
      plannedFrom: '2026-10-14T08:00:00.000Z',
      plannedTo: '2026-10-15T12:00:00.000Z',
    });

    const overdue = await request(app.getHttpServer())
      .get('/api/workshop/loaner-bookings/overdue')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const overdueIds = overdue.body.data.map((row: { id: string }) => row.id);
    expect(overdueIds).toContain(overdueBooking.id);
    expect(overdueIds).not.toContain(notYetDue.id);
    expect(overdueIds).not.toContain(boundaryBooking.id);
    expect(overdue.body.asOf).toBe('2026-10-15T12:00:00.000Z');
  });

  it('clears workshop_order_id but keeps tenant when the order is deleted', async () => {
    const vehicle = await prisma.vehicle.create({
      data: {
        customer_id: customerId,
        make: 'VW',
        model: 'Polo',
        year: 2018,
        plate: 'W-ORD-DEL',
      },
    });
    const workshopOrder = await prisma.workshopOrder.create({
      data: {
        site_id: siteId,
        customer_id: customerId,
        vehicle_id: vehicle.id,
        order_number: 'WO-LOANER-DEL',
        status: 'SCHEDULED',
        odometer: 12000,
        fuel_level: 40,
      },
    });

    const booking = await createReservedBooking({
      workshopOrderId: workshopOrder.id,
    });
    expect(booking.workshopOrderId).toBe(workshopOrder.id);

    await prisma.workshopOrder.delete({ where: { id: workshopOrder.id } });

    const refreshed = await prisma.loanerBooking.findFirstOrThrow({
      where: { id: booking.id, tenant_id: tenant.tenantId },
    });
    expect(refreshed.tenant_id).toBe(tenant.tenantId);
    expect(refreshed.workshop_order_id).toBeNull();
  });

  it('shows a handed-over car available for a later window when the loan is not overdue', async () => {
    setLoanerNowForTests(new Date('2026-10-10T08:00:00.000Z'));
    const booking = await createReservedBooking({
      plannedFrom: '2026-10-05T08:00:00.000Z',
      plannedTo: '2026-10-14T18:00:00.000Z',
    });
    await request(app.getHttpServer())
      .post(`/api/workshop/loaner-bookings/${booking.id}/hand-over`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        odometerOut: 4000,
        fuelOut: 70,
        driverLicenceChecked: true,
      })
      .expect(201);

    const availability = await request(app.getHttpServer())
      .get(
        '/api/workshop/loaner-vehicles/availability?from=2026-10-20T08:00:00.000Z&to=2026-10-22T18:00:00.000Z&asOf=2026-10-10T08:00:00.000Z',
      )
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const row = availability.body.data.find(
      (entry: { vehicle: { id: string } }) => entry.vehicle.id === loanerVehicleId,
    );
    expect(row?.available).toBe(true);
  });

  it('blocks availability for an overdue handed-over loan outside its planned window', async () => {
    setLoanerNowForTests(new Date('2026-10-16T08:00:00.000Z'));
    const booking = await createReservedBooking({
      plannedFrom: '2026-10-05T08:00:00.000Z',
      plannedTo: '2026-10-14T18:00:00.000Z',
    });
    await request(app.getHttpServer())
      .post(`/api/workshop/loaner-bookings/${booking.id}/hand-over`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        odometerOut: 5000,
        fuelOut: 65,
        driverLicenceChecked: true,
      })
      .expect(201);

    const availability = await request(app.getHttpServer())
      .get(
        '/api/workshop/loaner-vehicles/availability?from=2026-10-20T08:00:00.000Z&to=2026-10-22T18:00:00.000Z&asOf=2026-10-16T08:00:00.000Z',
      )
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const row = availability.body.data.find(
      (entry: { vehicle: { id: string } }) => entry.vehicle.id === loanerVehicleId,
    );
    expect(row?.available).toBe(false);
  });

  it('marks reserved overlapping vehicles unavailable regardless of asOf', async () => {
    await createReservedBooking({
      plannedFrom: '2026-11-01T08:00:00.000Z',
      plannedTo: '2026-11-05T18:00:00.000Z',
    });

    const availability = await request(app.getHttpServer())
      .get(
        '/api/workshop/loaner-vehicles/availability?from=2026-11-02T08:00:00.000Z&to=2026-11-04T18:00:00.000Z&asOf=2026-10-01T08:00:00.000Z',
      )
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const row = availability.body.data.find(
      (entry: { vehicle: { id: string } }) => entry.vehicle.id === loanerVehicleId,
    );
    expect(row?.available).toBe(false);
  });

  it('rejects hand-over while the vehicle is already on loan', async () => {
    const first = await createReservedBooking({
      plannedFrom: '2026-12-01T08:00:00.000Z',
      plannedTo: '2026-12-05T18:00:00.000Z',
    });
    await request(app.getHttpServer())
      .post(`/api/workshop/loaner-bookings/${first.id}/hand-over`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        odometerOut: 3000,
        fuelOut: 70,
        driverLicenceChecked: true,
      })
      .expect(201);

    const second = await createReservedBooking({
      plannedFrom: '2026-12-10T08:00:00.000Z',
      plannedTo: '2026-12-12T18:00:00.000Z',
    });

    const conflict = await request(app.getHttpServer())
      .post(`/api/workshop/loaner-bookings/${second.id}/hand-over`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        odometerOut: 3100,
        fuelOut: 60,
        driverLicenceChecked: true,
      })
      .expect(409);

    expect(conflict.body.code ?? conflict.body.message).toEqual(
      expect.stringMatching(new RegExp(LOANER_VEHICLE_ON_LOAN)),
    );
  });

  it('blocks fleet delete when booking history exists', async () => {
    const created = await createReservedBooking();
    await request(app.getHttpServer())
      .post(`/api/workshop/loaner-bookings/${created.id}/cancel`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);

    const response = await request(app.getHttpServer())
      .delete(`/api/workshop/loaner-vehicles/${loanerVehicleId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(409);

    expect(response.body.code ?? response.body.message).toEqual(
      expect.stringMatching(new RegExp(LOANER_FLEET_DELETE_BLOCKED)),
    );
  });

  it('marks a reserved booking as no-show', async () => {
    const created = await createReservedBooking();
    const response = await request(app.getHttpServer())
      .post(`/api/workshop/loaner-bookings/${created.id}/no-show`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);

    expect(response.body.status).toBe('NO_SHOW');
  });
});
