import { createE2eApp } from './helpers/e2e-suite.js';
import { AuthService } from '../src/auth/auth.service.js';
import 'dotenv/config';

import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { normalizeVehicleMakeAlias } from '../src/catalog/vehicle-make-alias.util.js';
import { cleanupTestTenantGraph, createTenantAwarePrisma, createTestAuthToken, createTestTenant } from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

const PREFIX = 'workflow-catalog-';

describe('Catalog Workflow Search (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;

  // Track created IDs for deterministic cleanup
  const createdBrandIds: number[] = [];
  const createdLaborOpIds: string[] = [];
  let createdWorkshopOrderId: string | undefined;
  let createdCustomerId: string | undefined;
  let createdVehicleId: string | undefined;

  beforeAll(async () => {
    app = await createE2eApp();

    basePrisma = app.get<PrismaService>(PrismaService);

    const testTenant = await createTestTenant(basePrisma);
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    authToken = createTestAuthToken(app.get(AuthService), testTenant);
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
        // The register intake starts an OWNER party, which restricts the vehicle delete.
        await prisma.vehicleParty.deleteMany({
          where: { vehicle_id: createdVehicleId },
        });
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
      if (tenantId) {
        await cleanupTestTenantGraph(basePrisma, tenantId);
      }
    } finally {
      await teardownTestApp(app, basePrisma);
    }
  });

  it('should complete full business workflow and correctly filter labor by fitment', async () => {
    const ts = Date.now();

    // 1. Setup Master Data (Brands)
    const skodaBrand = await prisma.brand.create({
      data: {
        tenant_id: tenantId,
        name: `${PREFIX}Skoda-${ts}`,
        normalized_name: normalizeVehicleMakeAlias(`${PREFIX}Skoda-${ts}`),
        isVehicleMake: true,
        isPartManufacturer: false,
      },
    });
    createdBrandIds.push(skodaBrand.id);

    const bmwBrand = await prisma.brand.create({
      data: {
        tenant_id: tenantId,
        name: `${PREFIX}BMW-${ts}`,
        normalized_name: normalizeVehicleMakeAlias(`${PREFIX}BMW-${ts}`),
        isVehicleMake: true,
        isPartManufacturer: true,
      },
    });
    createdBrandIds.push(bmwBrand.id);

    // 2. Setup Test Labor Operations
    const universalCode = `${PREFIX}UNIVERSAL-${ts}`;
    const matchingCode = `${PREFIX}MATCHING-${ts}`;
    const nonMatchingCode = `${PREFIX}NON-MATCHING-${ts}`;

    // Case A: Universal (No fitments)
    const opUniversal = await prisma.laborOperation.create({
      data: {
        tenant_id: tenantId,
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
        tenant_id: tenantId,
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
        tenant_id: tenantId,
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
      .set('Authorization', `Bearer ${authToken}`)
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
      .set('Authorization', `Bearer ${authToken}`)
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
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const labor = searchResponse.body.labor;
    const foundCodes = labor.map((l: any) => l.code);

    // Assertions
    expect(foundCodes).toContain(universalCode); // Correctly found Universal
    expect(foundCodes).toContain(matchingCode); // Correctly found Specific Matching
    expect(foundCodes).not.toContain(nonMatchingCode); // Correctly HIDDEN Non-matching
  });
});
