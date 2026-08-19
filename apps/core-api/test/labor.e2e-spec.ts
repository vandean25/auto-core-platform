import { AuthService } from '../src/auth/auth.service';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTenantAwarePrisma, createTestAuthToken, createTestTenant } from './tenant-test-utils';
import { teardownTestApp } from './test-lifecycle';

type CategoryNode = { id: string; name: string; children: CategoryNode[] };
type OperationListItem = { id: string; isActive: boolean; categoryId?: string };
type SearchResultItem = { id: string; categoryName: string | null };

const PREFIX = 'e2e-labor-';

describe('Labor Module (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let prisma: PrismaService;

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

    prisma = app.get<PrismaService>(PrismaService);

    const testTenant = await createTestTenant(prisma);
    prisma = createTenantAwarePrisma(prisma, testTenant.tenantId);
    authToken = createTestAuthToken(app.get(AuthService), testTenant);

    // Clean up only records created by this suite (scoped by PREFIX)
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
    await teardownTestApp(app, prisma);
  });

  // ── LaborCategory ──────────────────────────────────────────────────────

  describe('LaborCategory CRUD', () => {
    let topLevelCategoryId: string;
    let subCategoryId: string;
    let categoryForDeletionId: string;

    it('should create a top-level category → 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/labor/categories')
          .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: `${PREFIX}Engine Repair`,
          description: 'Engine-related repairs',
        })
        .expect(201);

      expect(res.body).toMatchObject({
        name: `${PREFIX}Engine Repair`,
        description: 'Engine-related repairs',
        parent_id: null,
        is_active: true,
      });
      expect(res.body.id).toBeDefined();
      topLevelCategoryId = res.body.id;
    });

    it('should create a subcategory with valid parent_id → 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/labor/categories')
          .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: `${PREFIX}Cylinder Head`,
          description: 'Cylinder head work',
          parent_id: topLevelCategoryId,
        })
        .expect(201);

      expect(res.body).toMatchObject({
        name: `${PREFIX}Cylinder Head`,
        parent_id: topLevelCategoryId,
        is_active: true,
      });
      subCategoryId = res.body.id;
    });

    it('should reject creation with depth > 2 → 400', async () => {
      // subCategoryId already has a parent, so creating a child of it exceeds max depth
      const res = await request(app.getHttpServer())
        .post('/api/labor/categories')
          .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: `${PREFIX}Too Deep Category`,
          parent_id: subCategoryId,
        })
        .expect(400);

      expect(res.body.message).toContain('Maximum category depth');
    });

    it('should reject duplicate category name → 409', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/labor/categories')
          .set('Authorization', `Bearer ${authToken}`)
        .send({ name: `${PREFIX}Engine Repair` })
        .expect(409);

      expect(res.body.message).toContain('already exists');
    });

    it('should update category name → 200', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/labor/categories/${topLevelCategoryId}`)
          .set('Authorization', `Bearer ${authToken}`)
        .send({ name: `${PREFIX}Engine Repair Updated` })
        .expect(200);

      expect(res.body).toMatchObject({
        name: `${PREFIX}Engine Repair Updated`,
      });
    });

    it('should list categories as tree structure → 200', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/labor/categories')
          .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('meta');
      expect(Array.isArray(res.body.data)).toBe(true);

      const parent = (res.body.data as CategoryNode[]).find(
        (c) => c.id === topLevelCategoryId,
      );
      expect(parent).toBeDefined();
      expect(Array.isArray(parent!.children)).toBe(true);
      expect(parent!.children.length).toBeGreaterThan(0);
      const child = parent!.children.find((c) => c.id === subCategoryId);
      expect(child).toBeDefined();
    });

    it('should reject deletion of a category that has children → 409', async () => {
      // topLevelCategoryId has subCategoryId as a child
      const res = await request(app.getHttpServer())
        .delete(`/api/labor/categories/${topLevelCategoryId}`)
          .set('Authorization', `Bearer ${authToken}`)
        .expect(409);

      expect(res.body.message).toContain('child');
    });

    it('should reject deletion of a category that has operations → 409', async () => {
      // Create a standalone category and attach an operation to it
      const catRes = await request(app.getHttpServer())
        .post('/api/labor/categories')
          .set('Authorization', `Bearer ${authToken}`)
        .send({ name: `${PREFIX}Category With Ops` })
        .expect(201);
      const catId = catRes.body.id;

      await request(app.getHttpServer())
        .post('/api/labor/operations')
          .set('Authorization', `Bearer ${authToken}`)
        .send({
          code: `${PREFIX}OP-GUARD-001`,
          description: 'Guard test operation',
          standardAw: 1.0,
          hourlyRate: 75.0,
          categoryId: catId,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .delete(`/api/labor/categories/${catId}`)
          .set('Authorization', `Bearer ${authToken}`)
        .expect(409);

      expect(res.body.message).toContain('operation');
    });

    it('should delete an empty category → 200', async () => {
      const catRes = await request(app.getHttpServer())
        .post('/api/labor/categories')
          .set('Authorization', `Bearer ${authToken}`)
        .send({ name: `${PREFIX}Empty Category` })
        .expect(201);
      categoryForDeletionId = catRes.body.id;

      const res = await request(app.getHttpServer())
        .delete(`/api/labor/categories/${categoryForDeletionId}`)
          .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.id).toBe(categoryForDeletionId);
    });
  });

  // ── LaborOperation ─────────────────────────────────────────────────────

  describe('LaborOperation CRUD', () => {
    let operationId: string;
    let categoryId: string;

    beforeAll(async () => {
      // Create a category to use in operation tests
      const catRes = await request(app.getHttpServer())
        .post('/api/labor/categories')
          .set('Authorization', `Bearer ${authToken}`)
        .send({ name: `${PREFIX}Transmission` })
        .expect(201);
      categoryId = catRes.body.id;
    });

    it('should create an operation with all fields → 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/labor/operations')
          .set('Authorization', `Bearer ${authToken}`)
        .send({
          code: `${PREFIX}TR-001`,
          description: 'Transmission overhaul',
          standardAw: 4.5,
          hourlyRate: 85.0,
          internalCost: 50.0,
          categoryId,
          fitments: [
            {
              make: 'Toyota',
              model: 'Camry',
              yearFrom: 2015,
              yearTo: 2022,
              engineCode: '2AR-FE',
            },
          ],
        })
        .expect(201);

      expect(res.body).toMatchObject({
        code: `${PREFIX}TR-001`,
        description: 'Transmission overhaul',
        standardAw: 4.5,
        hourlyRate: 85.0,
        internalCost: 50.0,
        isActive: true,
        categoryId,
      });
      expect(res.body.fitments).toHaveLength(1);
      expect(res.body.fitments[0]).toMatchObject({
        make: 'Toyota',
        model: 'Camry',
        yearFrom: 2015,
        yearTo: 2022,
        engineCode: '2AR-FE',
      });
      operationId = res.body.id;
    });

    it('should reject duplicate operation code → 409', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/labor/operations')
          .set('Authorization', `Bearer ${authToken}`)
        .send({
          code: `${PREFIX}TR-001`,
          description: 'Duplicate code attempt',
          standardAw: 1.0,
          hourlyRate: 50.0,
          categoryId,
        })
        .expect(409);

      expect(res.body.message).toContain('already exists');
    });

    it('should update an operation → 200', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/labor/operations/${operationId}`)
          .set('Authorization', `Bearer ${authToken}`)
        .send({
          description: 'Transmission overhaul (updated)',
          hourlyRate: 90.0,
        })
        .expect(200);

      expect(res.body).toMatchObject({
        id: operationId,
        description: 'Transmission overhaul (updated)',
        hourlyRate: 90.0,
      });
    });

    it('should replace fitments when updating operation → 200', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/labor/operations/${operationId}`)
          .set('Authorization', `Bearer ${authToken}`)
        .send({
          fitments: [
            { make: 'Honda', model: 'Accord', yearFrom: 2018, yearTo: 2023 },
          ],
        })
        .expect(200);

      expect(res.body.fitments).toHaveLength(1);
      expect(res.body.fitments[0]).toMatchObject({
        make: 'Honda',
        model: 'Accord',
        yearFrom: 2018,
        yearTo: 2023,
        engineCode: null,
      });
    });

    it('should soft-delete an operation → 200 with isActive = false', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/labor/operations/${operationId}`)
          .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toMatchObject({ id: operationId, isActive: false });
    });

    it('should list operations filtered by isActive=false → returns soft-deleted', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/labor/operations?isActive=false')
          .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('meta');
      const found = (res.body.data as OperationListItem[]).find(
        (op) => op.id === operationId,
      );
      expect(found).toBeDefined();
      expect(found!.isActive).toBe(false);
    });

    it('should list operations filtered by isActive=true → excludes soft-deleted', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/labor/operations?isActive=true')
          .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const found = (res.body.data as OperationListItem[]).find(
        (op) => op.id === operationId,
      );
      expect(found).toBeUndefined();
    });

    it('should list operations filtered by categoryId', async () => {
      // Create an active operation in the category
      const opRes = await request(app.getHttpServer())
        .post('/api/labor/operations')
          .set('Authorization', `Bearer ${authToken}`)
        .send({
          code: `${PREFIX}TR-CAT-001`,
          description: 'Category filter test',
          standardAw: 2.0,
          hourlyRate: 75.0,
          categoryId,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/labor/operations?categoryId=${categoryId}`)
          .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThan(0);
      (res.body.data as OperationListItem[]).forEach((op) => {
        expect(op.categoryId).toBe(categoryId);
      });

      // Cleanup
      await prisma.laborOperation.deleteMany({ where: { id: opRes.body.id } });
    });

    it('search endpoint should exclude inactive operations', async () => {
      const ts = Date.now();
      let vehicleId: string | undefined;
      let customerId: string | undefined;
      let workshopOrderId: string | undefined;
      let categoryId: string | undefined;
      const opIds: string[] = [];

      try {
        const vehicle = await prisma.vehicle.create({
          data: {
            vin: `e2e-labor-SRCH-${ts}`,
            make: 'Toyota',
            model: 'Corolla',
            year: 2020,
          },
        });
        vehicleId = vehicle.id;

        const customer = await prisma.customer.create({
          data: {
            first_name: 'Labor',
            last_name: 'Tester',
            email: `e2e-labor-${ts}@test.com`,
          },
        });
        customerId = customer.id;

        const workshopOrder = await prisma.workshopOrder.create({
          data: {
            customer_id: customerId,
            vehicle_id: vehicleId,
            order_number: `WO-e2e-labor-${ts}`,
            status: 'INTAKE',
            odometer: 0,
            fuel_level: 50,
          },
        });
        workshopOrderId = workshopOrder.id;

        const category = await prisma.laborCategory.create({
          data: {
            name: `${PREFIX}Search Category`,
            description: 'Category for labor search e2e coverage',
          },
        });
        categoryId = category.id;

        const activeOp = await prisma.laborOperation.create({
          data: {
            code: `e2e-labor-SRCH-ACT-${ts}`,
            description: 'SearchTerm Active Op',
            standard_aw: 1.0,
            hourly_rate: 60.0,
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
        opIds.push(activeOp.id);

        const inactiveOp = await prisma.laborOperation.create({
          data: {
            code: `e2e-labor-SRCH-INACT-${ts}`,
            description: 'SearchTerm Inactive Op',
            standard_aw: 1.0,
            hourly_rate: 60.0,
            is_active: false,
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
        opIds.push(inactiveOp.id);

        const res = await request(app.getHttpServer())
          .get(
            `/api/labor/search?q=SearchTerm&workshopOrderId=${workshopOrderId}`,
          )
            .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        const results = res.body.data as SearchResultItem[];
        const ids = results.map((op) => op.id);
        expect(ids).toContain(activeOp.id);
        expect(ids).not.toContain(inactiveOp.id);
        expect(results.find((op) => op.id === activeOp.id)?.categoryName).toBe(
          `${PREFIX}Search Category`,
        );
        expect(results.find((op) => op.id === inactiveOp.id)).toBeUndefined();
      } finally {
        if (opIds.length > 0) {
          await prisma.laborFitment.deleteMany({
            where: { labor_operation_id: { in: opIds } },
          });
          await prisma.laborOperation.deleteMany({
            where: { id: { in: opIds } },
          });
        }
        if (categoryId)
          await prisma.laborCategory.deleteMany({ where: { id: categoryId } });
        if (workshopOrderId)
          await prisma.workshopOrder.deleteMany({ where: { id: workshopOrderId } });
        if (vehicleId)
          await prisma.vehicle.deleteMany({ where: { id: vehicleId } });
        if (customerId)
          await prisma.customer.deleteMany({ where: { id: customerId } });
      }
    });
  });
});
