import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Workshop Intake Module (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let customerId: string;
  let vehicleId: string;

  beforeAll(async () => {
    process.env.API_KEY = 'test-api-key';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    // Clean up
    try {
      await prisma.workshopOrder.deleteMany();
      await prisma.vehicle.deleteMany();
      await prisma.customer.deleteMany();
    } catch (error) {
       console.log("Cleanup failed", error);
    }

    // Setup Test Data
    const customer = await prisma.customer.create({
      data: {
        first_name: 'Workshop',
        last_name: 'Tester',
        email: 'workshop@test.com',
        type: 'PRIVATE',
      },
    });
    customerId = customer.id;

    const vehicle = await prisma.vehicle.create({
      data: {
        make: 'Toyota',
        model: 'Corolla',
        year: 2020,
        vin: 'TESTVIN123456789',
        plate: 'W-1234AB',
        customer_id: customerId,
      },
    });
    vehicleId = vehicle.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('/api/workshop/search (GET) - should find vehicle by VIN', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/workshop/search?q=TESTVIN')
      .set('x-api-key', 'test-api-key')
      .expect(200);

    expect(res.body.vehicles).toBeDefined();
    expect(res.body.vehicles.length).toBeGreaterThan(0);
    expect(res.body.vehicles[0].vin).toBe('TESTVIN123456789');
  });

  it('/api/workshop/orders (POST) - should create workshop order', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/workshop/orders')
      .set('x-api-key', 'test-api-key')
      .send({
        customerId,
        vehicleId,
        odometer: 50000,
        fuelLevel: 75,
        notes: 'Check engine light',
      })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe('INTAKE');
    expect(res.body.odometer).toBe(50000);
  });

  it('/api/workshop/orders (POST) - should validate fuel level', async () => {
    await request(app.getHttpServer())
      .post('/api/workshop/orders')
      .set('x-api-key', 'test-api-key')
      .send({
        customerId,
        vehicleId,
        odometer: 50000,
        fuelLevel: 101, // Invalid
        notes: 'Check engine light',
      })
      .expect(400);
  });
});
