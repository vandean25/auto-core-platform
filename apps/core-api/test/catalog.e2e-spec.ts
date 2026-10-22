import { createE2eApp } from './helpers/e2e-suite.js';
import { AuthService } from '../src/auth/auth.service.js';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

type CatalogSearchLaborItem = { id: string; categoryName: string | null };

const PREFIX = 'e2e-catalog-';

describe('Catalog Module (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;

  beforeAll(async () => {
    app = await createE2eApp();

    basePrisma = app.get<PrismaService>(PrismaService);

    const testTenant = await createTestTenant(basePrisma);
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(basePrisma, testTenant.tenantId);
    authToken = createTestAuthToken(app.get(AuthService), testTenant);

    await prisma.laborFitment.deleteMany({
      where: { labor_operation: { code: { startsWith: PREFIX } } },
    });
    await prisma.laborOperation.deleteMany({
      where: { code: { startsWith: PREFIX } },
    });
    await prisma.laborCategory.deleteMany({
      where: { name: { startsWith: PREFIX } },
    });
  });

  afterAll(async () => {
    await prisma.laborFitment.deleteMany({
      where: { labor_operation: { code: { startsWith: PREFIX } } },
    });
    await prisma.laborOperation.deleteMany({
      where: { code: { startsWith: PREFIX } },
    });
    await prisma.laborCategory.deleteMany({
      where: { name: { startsWith: PREFIX } },
    });
    await teardownTestApp(app, basePrisma);
  });

  it('search endpoint should return categoryName for categorized and uncategorized labor results', async () => {
    const ts = Date.now();
    let vehicleId: string | undefined;
    let customerId: string | undefined;
    let workshopOrderId: string | undefined;
    let categoryId: string | undefined;
    const opIds: string[] = [];

    try {
      const vehicle = await prisma.vehicle.create({
        data: {
          tenant_id: tenantId,
          vin: `e2e-catalog-${ts}`,
          make: 'Toyota',
          model: 'Corolla',
          year: 2020,
        },
      });
      vehicleId = vehicle.id;

      const customer = await prisma.customer.create({
        data: {
          tenant_id: tenantId,
          first_name: 'Catalog',
          last_name: 'Tester',
          email: `e2e-catalog-${ts}@test.com`,
        },
      });
      customerId = customer.id;
      const mainSite = await prisma.site.findFirstOrThrow({
        where: { code: 'MAIN' },
      });

      const workshopOrder = await prisma.workshopOrder.create({
        data: {
          tenant_id: tenantId,
          site_id: mainSite.id,
          customer_id: customerId,
          vehicle_id: vehicleId,
          order_number: `WO-e2e-catalog-${ts}`,
          status: 'INTAKE',
          odometer: 0,
          fuel_level: 50,
        },
      });
      workshopOrderId = workshopOrder.id;

      const category = await prisma.laborCategory.create({
        data: {
          tenant_id: tenantId,
          name: `${PREFIX}Search Category`,
          description: 'Category for catalog search e2e coverage',
        },
      });
      categoryId = category.id;

      const categorizedOp = await prisma.laborOperation.create({
        data: {
          tenant_id: tenantId,
          code: `e2e-catalog-CAT-${ts}`,
          description: 'SearchTerm Categorized Op',
          standard_aw: 1.25,
          hourly_rate: 75.0,
          is_active: true,
          category_id: categoryId,
          fitments: {
            create: {
              make: 'Toyota',
              model: 'Corolla',
              year_from: 2018,
              year_to: 2023,
            },
          },
        },
      });
      opIds.push(categorizedOp.id);

      const uncategorizedOp = await prisma.laborOperation.create({
        data: {
          tenant_id: tenantId,
          code: `e2e-catalog-UNCAT-${ts}`,
          description: 'SearchTerm Uncategorized Op',
          standard_aw: 1.0,
          hourly_rate: 60.0,
          is_active: true,
          fitments: {
            create: {
              make: 'Toyota',
              model: 'Corolla',
              year_from: 2018,
              year_to: 2023,
            },
          },
        },
      });
      opIds.push(uncategorizedOp.id);

      const res = await request(app.getHttpServer())
        .get(
          `/api/catalog/search?q=SearchTerm&workshopOrderId=${workshopOrderId}`,
        )
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const results = res.body.labor as CatalogSearchLaborItem[];
      expect(
        results.find((op) => op.id === categorizedOp.id)?.categoryName,
      ).toBe(`${PREFIX}Search Category`);
      expect(
        results.find((op) => op.id === uncategorizedOp.id)?.categoryName,
      ).toBeNull();
    } finally {
      if (opIds.length > 0) {
        await prisma.laborFitment.deleteMany({
          where: { labor_operation_id: { in: opIds } },
        });
        await prisma.laborOperation.deleteMany({
          where: { id: { in: opIds } },
        });
      }
      if (categoryId) {
        await prisma.laborCategory.deleteMany({ where: { id: categoryId } });
      }
      if (workshopOrderId) {
        await prisma.workshopOrder.deleteMany({
          where: { id: workshopOrderId },
        });
      }
      if (vehicleId) {
        await prisma.vehicle.deleteMany({ where: { id: vehicleId } });
      }
      if (customerId) {
        await prisma.customer.deleteMany({ where: { id: customerId } });
      }
    }
  });
});
