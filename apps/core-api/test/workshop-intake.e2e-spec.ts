import { AuthService } from '../src/auth/auth.service';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
} from './tenant-test-utils';
import { teardownTestApp } from './test-lifecycle';

describe('Workshop Intake Module (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let customerId: string;
  let vehicleId: string;
  let tenantId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    basePrisma = app.get(PrismaService);
    const testTenant = await createTestTenant(basePrisma, 'workshop-intake');
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    authToken = createTestAuthToken(app.get(AuthService), testTenant);

    const customer = await prisma.customer.create({
      data: {
        first_name: 'Workshop',
        last_name: 'Tester',
        email: 'workshop@test.com',
        phone: '+43 660 000000',
        type: 'PRIVATE',
      },
    });
    customerId = customer.id;

    const vehicle = await prisma.vehicle.create({
      data: {
        customer_id: customerId,
        make: 'Toyota',
        model: 'Corolla',
        year: 2020,
        vin: 'TESTVIN123456789',
        plate: 'W-1234AB',
      },
    });
    vehicleId = vehicle.id;
  });

  afterAll(async () => {
    if (tenantId) {
      await cleanupTestTenantGraph(basePrisma, tenantId);
    }
    await teardownTestApp(app, basePrisma);
  });

  it('/api/workshop/search (GET) - should find vehicle by VIN', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/workshop/search?q=TESTVIN')
        .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body.data.vehicles).toBeDefined();
    expect(res.body.data.vehicles.length).toBeGreaterThan(0);
    expect(res.body.data.vehicles[0].vin).toBe('TESTVIN123456789');
  });

  it('/api/workshop/orders (POST) - should create workshop order', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/workshop/orders')
        .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        vehicleId,
        odometer: 50000,
        fuelLevel: 75,
        notes: 'Check engine light',
      })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.order_number).toMatch(/^WO-\d{4}-\d+$/);
    expect(res.body.status).toBe('INTAKE');
    expect(res.body.odometer).toBe(50000);
  });

  it('/api/workshop/orders (POST) - should validate fuel level', async () => {
    await request(app.getHttpServer())
      .post('/api/workshop/orders')
        .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        vehicleId,
        odometer: 50000,
        fuelLevel: 101, // Invalid
        notes: 'Check engine light',
      })
      .expect(400);
  });

  it('/api/workshop/register (POST) - should register vehicle using upsert', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/workshop/register')
        .set('Authorization', `Bearer ${authToken}`)
      .send({
        vin: 'NEWVIN123',
        plate: 'NEW-PLATE',
        make: 'Toyota',
        model: 'Corolla',
        year: 2020,
        firstName: 'New',
        lastName: 'User',
        email: 'new@test.com',
      })
      .expect(201);

    expect(res.body.vin).toBe('NEWVIN123');
  });
});
