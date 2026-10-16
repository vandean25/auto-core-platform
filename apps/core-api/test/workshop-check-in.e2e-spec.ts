import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

jest.setTimeout(30000);

describe('Workshop check-in (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let otherTenantId: string;
  let authToken: string;
  let otherAuthToken: string;
  let orderId: string;
  let otherOrderId: string;
  const checkInId = '51500000-0000-4000-8000-000000000555';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    const basePrisma = app.get<PrismaService>(PrismaService);
    const authService = app.get<AuthService>(AuthService);

    const tenantA = await createTestTenant(basePrisma, 'aut555a');
    const tenantB = await createTestTenant(basePrisma, 'aut555b');
    tenantId = tenantA.tenantId;
    otherTenantId = tenantB.tenantId;
    authToken = createTestAuthToken(authService, tenantA);
    otherAuthToken = createTestAuthToken(authService, tenantB);

    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    const otherPrisma = createTenantAwarePrisma(basePrisma, otherTenantId);
    const siteId = await resolveTestMainSiteId(basePrisma, tenantId);
    const otherSiteId = await resolveTestMainSiteId(basePrisma, otherTenantId);

    const customer = await prisma.customer.create({
      data: {
        first_name: 'Pilot',
        last_name: 'Customer',
        email: `aut555-${Date.now()}@example.com`,
        type: 'PRIVATE',
      },
    });
    const vehicle = await prisma.vehicle.create({
      data: {
        make: 'VW',
        model: 'Golf',
        year: 2020,
        vin: `VIN-AUT555-${Date.now()}`,
        customer_id: customer.id,
      },
    });
    const order = await prisma.workshopOrder.create({
      data: {
        order_number: `WO-AUT555-${Date.now()}`,
        site_id: siteId,
        customer_id: customer.id,
        vehicle_id: vehicle.id,
        odometer: 125000,
        fuel_level: 40,
        status: 'INTAKE',
      },
    });
    orderId = order.id;

    const otherCustomer = await otherPrisma.customer.create({
      data: {
        first_name: 'Other',
        last_name: 'Tenant',
        email: `aut555-other-${Date.now()}@example.com`,
        type: 'PRIVATE',
      },
    });
    const otherVehicle = await otherPrisma.vehicle.create({
      data: {
        make: 'Audi',
        model: 'A3',
        year: 2019,
        vin: `VIN-AUT555-OTHER-${Date.now()}`,
        customer_id: otherCustomer.id,
      },
    });
    const otherOrder = await otherPrisma.workshopOrder.create({
      data: {
        order_number: `WO-AUT555-OTHER-${Date.now()}`,
        site_id: otherSiteId,
        customer_id: otherCustomer.id,
        vehicle_id: otherVehicle.id,
        odometer: 90000,
        fuel_level: 70,
        status: 'INTAKE',
      },
    });
    otherOrderId = otherOrder.id;
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(app.get(PrismaService), tenantId);
    await cleanupTestTenantGraph(app.get(PrismaService), otherTenantId);
    await teardownTestApp(app);
  });

  it('creates, reads, and updates a draft check-in', async () => {
    const createRes = await request(app.getHttpServer())
      .post(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ id: checkInId })
      .expect(201);

    expect(createRes.body.odometer).toBe(125000);
    expect(createRes.body.fuel_level).toBe(40);
    expect(createRes.body.status).toBe('DRAFT');
    expect(createRes.body.revision).toBe(1);

    const getRes = await request(app.getHttpServer())
      .get(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(getRes.body.id).toBe(checkInId);

    const patchRes = await request(app.getHttpServer())
      .patch(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expected_revision: 1,
        items_left: 'pilot customer umbrella',
        key_count: 2,
        warning_lights: ['ABS'],
        odometer: 125010,
        fuel_level: 38,
        condition: {
          tyre_season: 'WINTER',
          exterior_notes: 'Light scratch rear bumper',
          interior_notes: '',
        },
        damage_markers: [
          {
            zone_id: 'rear_bumper',
            type: 'SCRATCH',
            media_id: null,
          },
        ],
      })
      .expect(200);

    expect(patchRes.body.revision).toBe(2);
    expect(patchRes.body.items_left).toBe('pilot customer umbrella');
    expect(patchRes.body.odometer).toBe(125010);
  });

  it('isolates check-in reads across tenants', async () => {
    await request(app.getHttpServer())
      .get(`/api/workshop/orders/${orderId}/check-in`)
      .set('Authorization', `Bearer ${otherAuthToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/workshop/orders/${otherOrderId}/check-in`)
      .set('Authorization', `Bearer ${otherAuthToken}`)
      .expect(404);
  });
});
