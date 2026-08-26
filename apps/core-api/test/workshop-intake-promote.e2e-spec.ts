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

describe('Workshop intake promote (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let customerId: string;
  let vehicleId: string;
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
    const testTenant = await createTestTenant(
      basePrisma,
      'workshop-intake-promote',
    );
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    authToken = createTestAuthToken(app.get(AuthService), testTenant);

    const customer = await prisma.customer.create({
      data: {
        first_name: 'Promote',
        last_name: 'Tester',
        email: `intake-promote-${Date.now()}@test.com`,
        type: 'PRIVATE',
      },
    });
    customerId = customer.id;

    const [vehicle, bay] = await Promise.all([
      prisma.vehicle.create({
        data: {
          customer_id: customerId,
          make: 'VW',
          model: 'Golf',
          year: 2021,
          vin: `VIN-PROMOTE-${Date.now()}`,
        },
      }),
      prisma.bay.create({
        data: {
          name: `Promote Bay ${Date.now()}`,
          is_active: true,
          sort_order: 1,
        },
      }),
    ]);
    vehicleId = vehicle.id;
    bayId = bay.id;
  });

  afterAll(async () => {
    if (tenantId) {
      await cleanupTestTenantGraph(basePrisma, tenantId);
    }
    await teardownTestApp(app, basePrisma);
  });

  it('promotes a scheduled booking to intake with the same order number', async () => {
    const scheduled = await request(app.getHttpServer())
      .post('/api/workshop/orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        vehicleId,
        status: 'SCHEDULED',
        bayId,
        scheduledStartAt: '2026-08-21T08:00:00.000Z',
        scheduledEndAt: '2026-08-21T09:00:00.000Z',
      })
      .expect(201);

    expect(scheduled.body.status).toBe('SCHEDULED');
    const scheduledOrderNumber = scheduled.body.order_number;

    const beforePromote = await prisma.financeSettings.findFirstOrThrow({
      where: { tenant_id: tenantId },
      select: { next_workshop_order_number: true },
    });

    const intake = await request(app.getHttpServer())
      .post('/api/workshop/orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        vehicleId,
        odometer: 54321,
        fuelLevel: 55,
        reportedIssue: 'Customer arrived for booking',
      })
      .expect(201);

    expect(intake.body.id).toBe(scheduled.body.id);
    expect(intake.body.order_number).toBe(scheduledOrderNumber);
    expect(intake.body.status).toBe('INTAKE');
    expect(intake.body.odometer).toBe(54321);
    expect(intake.body.fuel_level).toBe(55);
    expect(intake.body.reported_issue).toBe('Customer arrived for booking');

    const afterPromote = await prisma.financeSettings.findFirstOrThrow({
      where: { tenant_id: tenantId },
      select: { next_workshop_order_number: true },
    });
    expect(afterPromote.next_workshop_order_number).toBe(
      beforePromote.next_workshop_order_number,
    );
  });

  it('defaults the first task scheduled_date from the booking start date', async () => {
    const [vehicle, bay] = await Promise.all([
      prisma.vehicle.create({
        data: {
          customer_id: customerId,
          make: 'VW',
          model: 'Polo',
          year: 2020,
          vin: `VIN-TASK-DATE-${Date.now()}`,
        },
      }),
      prisma.bay.create({
        data: {
          name: `Task Date Bay ${Date.now()}`,
          is_active: true,
          sort_order: 2,
        },
      }),
    ]);

    const scheduled = await request(app.getHttpServer())
      .post('/api/workshop/orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        vehicleId: vehicle.id,
        status: 'SCHEDULED',
        bayId: bay.id,
        scheduledStartAt: '2026-08-21T08:30:00.000Z',
        scheduledEndAt: '2026-08-21T09:30:00.000Z',
      })
      .expect(201);

    const intake = await request(app.getHttpServer())
      .post('/api/workshop/orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        vehicleId: vehicle.id,
        odometer: 10000,
        fuelLevel: 50,
      })
      .expect(201);

    const taskRes = await request(app.getHttpServer())
      .post(`/api/workshop/orders/${intake.body.id}/tasks`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ title: 'Oil change' })
      .expect(201);

    expect(taskRes.body.scheduled_date).toMatch(/^2026-08-21/);
  });

  it('serializes concurrent promote requests to one intake and one conflict', async () => {
    const vehicle = await prisma.vehicle.create({
      data: {
        customer_id: customerId,
        make: 'VW',
        model: 'Passat',
        year: 2022,
        vin: `VIN-CONCURRENT-${Date.now()}`,
      },
    });

    await request(app.getHttpServer())
      .post('/api/workshop/orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        vehicleId: vehicle.id,
        status: 'SCHEDULED',
        bayId,
        scheduledStartAt: '2026-08-22T08:00:00.000Z',
        scheduledEndAt: '2026-08-22T09:00:00.000Z',
      })
      .expect(201);

    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/workshop/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          customerId,
          vehicleId: vehicle.id,
          odometer: 20000,
          fuelLevel: 40,
        }),
      request(app.getHttpServer())
        .post('/api/workshop/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          customerId,
          vehicleId: vehicle.id,
          odometer: 20001,
          fuelLevel: 41,
        }),
    ]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);

    const success = first.status === 201 ? first : second;
    const conflict = first.status === 409 ? first : second;
    expect(success.body.status).toBe('INTAKE');
    expect(conflict.body.message).toMatch(/already has active order/);
  });
});
