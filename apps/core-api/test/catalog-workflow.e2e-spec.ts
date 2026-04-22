import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTenantAwarePrisma, createTestTenant } from './tenant-test-utils';

const PREFIX = 'workflow-catalog-';

describe('Catalog Workflow Search (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let originalApiKey: string | undefined;

  // Track created IDs for deterministic cleanup
  const createdBrandIds: string[] = [];
  const createdLaborOpIds: string[] = [];
  let createdWorkshopOrderId: string | undefined;
  let createdCustomerId: string | undefined;
  let createdVehicleId: string | undefined;

  beforeAll(async () => {
    originalApiKey = process.env.API_KEY;
    process.env.API_KEY = 'test-api-key';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    const testTenant = await createTestTenant(prisma);
    prisma = createTenantAwarePrisma(prisma, testTenant.tenantId);
  });

  afterAll(async () => {
    // Deterministic cleanup of all test data
    try {
      if (createdWorkshopOrderId) {
        await prisma.workshopOrder.deleteMany({
          where: { id: createdWorkshopOrderId },
        });
      }
      if (createdVehicleId) {
        await prisma.vehicle.deleteMany({ where: { id: createdVehicleId } });
      }
      if (createdCustomerId) {
        await prisma.customer.deleteMany({ where: { id: createdCustomerId } });
      }
      if (createdLaborOpIds.length > 0) {
        await prisma.laborOperation.deleteMany({
          where: { id: { in: createdLaborOpIds } },
        });
      }
      if (createdBrandIds.length > 0) {
        await prisma.brand.deleteMany({
          where: { id: { in: createdBrandIds } },
        });
      }
    } finally {
      // Restore original API_KEY regardless of cleanup errors
      if (originalApiKey === undefined) {
        delete process.env.API_KEY;
      } else {
        process.env.API_KEY = originalApiKey;
      }
      await app.close();
    }
  });

  it('should complete full business workflow and correctly filter labor by fitment', async () => {
    const ts = Date.now();
    const apiKey = 'test-api-key';

    // 1. Setup Master Data (Brands)
    const skodaBrand = await prisma.brand.upsert({
      where: { name: 'Skoda' },
      create: { name: 'Skoda', isVehicleMake: true, isPartManufacturer: false },
      update: {},
    });
    createdBrandIds.push(skodaBrand.id);

    const bmwBrand = await prisma.brand.upsert({
      where: { name: 'BMW' },
      create: { name: 'BMW', isVehicleMake: true, isPartManufacturer: true },
      update: {},
    });
    createdBrandIds.push(bmwBrand.id);

    // 2. Setup Test Labor Operations
    const universalCode = `${PREFIX}UNIVERSAL-${ts}`;
    const matchingCode = `${PREFIX}MATCHING-${ts}`;
    const nonMatchingCode = `${PREFIX}NON-MATCHING-${ts}`;

    // Case A: Universal (No fitments)
    const opUniversal = await prisma.laborOperation.create({
      data: {
        code: universalCode,
        description: `SearchKey Universal ${ts}`,
        standard_aw: 1.0,
        hourly_rate: 100,
      },
    });
    createdLaborOpIds.push(opUniversal.id);

    // Case B: Matching (Skoda Octavia)
    const opMatching = await prisma.laborOperation.create({
      data: {
        code: matchingCode,
        description: `SearchKey Matching ${ts}`,
        standard_aw: 1.5,
        hourly_rate: 100,
        fitments: {
          create: {
            make: 'Skoda',
            model: 'Octavia',
            year_from: 2015,
          },
        },
      },
    });
    createdLaborOpIds.push(opMatching.id);

    // Case C: Non-Matching (BMW)
    const opNonMatching = await prisma.laborOperation.create({
      data: {
        code: nonMatchingCode,
        description: `SearchKey Hidden ${ts}`,
        standard_aw: 2.0,
        hourly_rate: 100,
        fitments: {
          create: {
            make: 'BMW',
            model: 'M3',
          },
        },
      },
    });
    createdLaborOpIds.push(opNonMatching.id);

    // 3. Register Customer & Vehicle (Skoda Octavia)
    const registerResponse = await request(app.getHttpServer())
      .post('/api/workshop/register')
      .set('x-api-key', apiKey)
      .send({
        firstName: 'Workflow',
        lastName: 'Tester',
        email: `${PREFIX}${ts}@test.com`,
        phone: '+43 664 0000000',
        make: 'Skoda',
        model: 'Octavia',
        year: 2020,
        vin: `${PREFIX}VIN-${ts}`,
        plate: `${PREFIX}PLATE-${ts}`,
      })
      .expect(201);

    createdCustomerId = registerResponse.body.customer_id;
    createdVehicleId = registerResponse.body.id;
    const vehicleId = createdVehicleId;
    const customerId = createdCustomerId;

    // 4. Create Workshop Order
    const orderResponse = await request(app.getHttpServer())
      .post('/api/workshop/orders')
      .set('x-api-key', apiKey)
      .send({
        customerId: customerId,
        vehicleId: vehicleId,
        odometer: 1000,
        fuelLevel: 100,
      })
      .expect(201);

    createdWorkshopOrderId = orderResponse.body.id;

    // 5. Final Step: Search and Verify Fitment Filtering
    const searchResponse = await request(app.getHttpServer())
      .get(
        `/api/catalog/search?q=SearchKey&workshopOrderId=${createdWorkshopOrderId}`,
      )
      .set('x-api-key', apiKey)
      .expect(200);

    const labor = searchResponse.body.labor;
    const foundCodes = labor.map((l: any) => l.code);

    // Assertions
    expect(foundCodes).toContain(universalCode); // Correctly found Universal
    expect(foundCodes).toContain(matchingCode); // Correctly found Specific Matching
    expect(foundCodes).not.toContain(nonMatchingCode); // Correctly HIDDEN Non-matching
  });
});
