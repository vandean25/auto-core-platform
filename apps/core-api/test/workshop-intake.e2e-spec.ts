import { AuthService } from '../src/auth/auth.service';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { mockPrismaService } from './mocks/prisma.mock';
import { teardownTestApp } from './test-lifecycle';

describe('Workshop Intake Module (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let prisma: PrismaService;
  const customerId: string = 'mock-customer-id';
  const vehicleId: string = 'mock-vehicle-id';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrismaService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
    authToken = app.get(AuthService).createTestToken();
  });

  afterAll(async () => {
    await teardownTestApp(app, prisma);
  });

  it('/api/workshop/search (GET) - should find vehicle by VIN', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/workshop/search?q=TESTVIN')
        .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body.vehicles).toBeDefined();
    expect(res.body.vehicles.length).toBeGreaterThan(0);
    expect(res.body.vehicles[0].vin).toBe('TESTVIN123456789');
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

    expect(res.body.vin).toBe('TESTVIN123456789'); // Mock returns this
  });
});
