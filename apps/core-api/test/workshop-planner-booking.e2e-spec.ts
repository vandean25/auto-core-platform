import { AuthService } from '../src/auth/auth.service';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createGlobalValidationPipe } from '../src/common';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
} from './tenant-test-utils';
import { teardownTestApp } from './test-lifecycle';

describe('Workshop planner booking (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let customerId: string;
  let vehicleAId: string;
  let vehicleBId: string;
  let vehicleCId: string;
  let bayId: string;
  let tenantId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    basePrisma = app.get(PrismaService);
    const testTenant = await createTestTenant(basePrisma, 'workshop-planner-book');
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    authToken = createTestAuthToken(app.get(AuthService), testTenant);

    const customer = await prisma.customer.create({
      data: {
        first_name: 'Planner',
        last_name: 'Booker',
        email: `planner-book-${Date.now()}@test.com`,
        type: 'PRIVATE',
      },
    });
    customerId = customer.id;

    const [vehicleA, vehicleB, vehicleC, bay] = await Promise.all([
      prisma.vehicle.create({
        data: {
          customer_id: customerId,
          make: 'VW',
          model: 'Golf',
          year: 2021,
          vin: `VIN-PLAN-A-${Date.now()}`,
        },
      }),
      prisma.vehicle.create({
        data: {
          customer_id: customerId,
          make: 'VW',
          model: 'Passat',
          year: 2022,
          vin: `VIN-PLAN-B-${Date.now()}`,
        },
      }),
      prisma.vehicle.create({
        data: {
          customer_id: customerId,
          make: 'VW',
          model: 'Polo',
          year: 2020,
          vin: `VIN-PLAN-C-${Date.now()}`,
        },
      }),
      prisma.bay.create({
        data: {
          name: `Planner Bay ${Date.now()}`,
          is_active: true,
          sort_order: 1,
        },
      }),
    ]);
    vehicleAId = vehicleA.id;
    vehicleBId = vehicleB.id;
    vehicleCId = vehicleC.id;
    bayId = bay.id;
  });

  afterAll(async () => {
    if (tenantId) {
      await cleanupTestTenantGraph(basePrisma, tenantId);
    }
    await teardownTestApp(app, basePrisma);
  });

  it('returns 409 when the vehicle already has an active order', async () => {
    await request(app.getHttpServer())
      .post('/api/workshop/orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        vehicleId: vehicleCId,
        odometer: 1000,
        fuelLevel: 40,
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/workshop/orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        vehicleId: vehicleCId,
        odometer: 1001,
        fuelLevel: 40,
      })
      .expect(409);

    expect(res.body.message).toMatch(/already has active order/);
  });

  it('serializes overlapping bay bookings to one 201 and one 409', async () => {
    const window = {
      scheduledStartAt: '2026-08-21T08:00:00.000Z',
      scheduledEndAt: '2026-08-21T09:00:00.000Z',
    };

    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/workshop/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          customerId,
          vehicleId: vehicleAId,
          status: 'SCHEDULED',
          bayId,
          ...window,
        }),
      request(app.getHttpServer())
        .post('/api/workshop/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          customerId,
          vehicleId: vehicleBId,
          status: 'SCHEDULED',
          bayId,
          ...window,
        }),
    ]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);
  });
});
