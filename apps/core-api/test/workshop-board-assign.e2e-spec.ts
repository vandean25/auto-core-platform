import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestTenant,
} from './tenant-test-utils';
import { teardownTestApp } from './test-lifecycle';

describe('Workshop Board Assign (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let tenantId: string;
  let customerId: string;
  let vehicleId: string;
  let orderId: string;
  let mechanicId: string;
  let nonMechanicEmployeeId: string;
  let authToken: string;

  beforeAll(async () => {
    process.env.API_KEY = 'test-api-key';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    const basePrisma = app.get<PrismaService>(PrismaService);
    const authService = app.get<AuthService>(AuthService);
    const testTenant = await createTestTenant(basePrisma, 'board-assign');
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    authToken = authService.createTestToken({
      sub: 'e2e-board-user',
      email: 'e2e-board-user@example.com',
      tenantId,
      role: 'ADMIN',
    });

    const customer = await prisma.customer.create({
      data: {
        first_name: 'Board',
        last_name: 'Tester',
        email: `board-assign-${Date.now()}@example.com`,
        type: 'PRIVATE',
      },
    });
    customerId = customer.id;

    const vehicle = await prisma.vehicle.create({
      data: {
        make: 'Audi',
        model: 'A4',
        year: 2020,
        vin: `VIN-BOARD-${Date.now()}`,
        customer_id: customerId,
      },
    });
    vehicleId = vehicle.id;

    const order = await prisma.workshopOrder.create({
      data: {
        order_number: `WO-E2E-${Date.now()}`,
        customer_id: customerId,
        vehicle_id: vehicleId,
        odometer: 120000,
        fuel_level: 45,
        status: 'INTAKE',
      },
    });
    orderId = order.id;

    const mechanic = await prisma.employee.create({
      data: {
        name: 'Board Mechanic',
        role: 'MECHANIC',
        is_active: true,
      },
    });
    mechanicId = mechanic.id;

    const nonMechanic = await prisma.employee.create({
      data: {
        name: 'Board Advisor',
        role: 'SERVICE_ADVISOR',
        is_active: true,
      },
    });
    nonMechanicEmployeeId = nonMechanic.id;
  });

  afterAll(async () => {
    if (tenantId) {
      await cleanupTestTenantGraph(app.get<PrismaService>(PrismaService), tenantId);
    }
    await teardownTestApp(app, prisma);
  });

  it('assigns a mechanic and returns 200', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/workshop/board/assign')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        orderId,
        mechanicId,
      })
      .expect(200);

    expect(res.body.id).toBe(orderId);
    expect(res.body.mechanicId).toBe(mechanicId);
  });

  it('unassigns mechanic with mechanicId: null without throwing 500', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/workshop/board/assign')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        orderId,
        mechanicId: null,
      })
      .expect(200);

    expect(res.body.id).toBe(orderId);
    expect(res.body.mechanicId).toBeNull();
  });

  it('rejects assigning a non-mechanic employee with 422', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/workshop/board/assign')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        orderId,
        mechanicId: nonMechanicEmployeeId,
      })
      .expect(422);

    expect(String(res.body.message)).toContain('is not a MECHANIC');
  });
});
