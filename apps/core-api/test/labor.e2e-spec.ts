import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Labor Module (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.API_KEY = 'test-api-key';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    // Clean up labor data before running tests
    await prisma.laborFitment.deleteMany();
    await prisma.laborOperation.deleteMany();
    await prisma.laborCategory.deleteMany();
  });

  afterAll(async () => {
    await prisma.laborFitment.deleteMany();
    await prisma.laborOperation.deleteMany();
    await prisma.laborCategory.deleteMany();
    await app.close();
  });

  // ── LaborCategory ──────────────────────────────────────────────────────

  describe('LaborCategory CRUD', () => {
    let topLevelCategoryId: string;
    let subCategoryId: string;
    let categoryForDeletionId: string;

    it('should create a top-level category → 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/labor/categories')
        .set('x-api-key', 'test-api-key')
        .send({ name: 'Engine Repair', description: 'Engine-related repairs' })
        .expect(201);

      expect(res.body).toMatchObject({
        name: 'Engine Repair',
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
        .set('x-api-key', 'test-api-key')
        .send({
          name: 'Cylinder Head',
          description: 'Cylinder head work',
          parent_id: topLevelCategoryId,
        })
        .expect(201);

      expect(res.body).toMatchObject({
        name: 'Cylinder Head',
        parent_id: topLevelCategoryId,
        is_active: true,
      });
      subCategoryId = res.body.id;
    });

    it('should reject creation with depth > 2 → 400', async () => {
      // subCategoryId already has a parent, so creating a child of it exceeds max depth
      const res = await request(app.getHttpServer())
        .post('/api/labor/categories')
        .set('x-api-key', 'test-api-key')
        .send({
          name: 'Too Deep Category',
          parent_id: subCategoryId,
        })
        .expect(400);

      expect(res.body.message).toContain('Maximum category depth');
    });

    it('should reject duplicate category name → 409', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/labor/categories')
        .set('x-api-key', 'test-api-key')
        .send({ name: 'Engine Repair' })
        .expect(409);

      expect(res.body.message).toContain('already exists');
    });

    it('should update category name → 200', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/labor/categories/${topLevelCategoryId}`)
        .set('x-api-key', 'test-api-key')
        .send({ name: 'Engine Repair Updated' })
        .expect(200);

      expect(res.body).toMatchObject({ name: 'Engine Repair Updated' });
    });

    it('should list categories as tree structure → 200', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/labor/categories')
        .set('x-api-key', 'test-api-key')
        .expect(200);

      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('meta');
      expect(Array.isArray(res.body.data)).toBe(true);

      const parent = res.body.data.find(
        (c: any) => c.id === topLevelCategoryId,
      );
      expect(parent).toBeDefined();
      expect(Array.isArray(parent.children)).toBe(true);
      expect(parent.children.length).toBeGreaterThan(0);
      expect(parent.children[0].id).toBe(subCategoryId);
    });

    it('should reject deletion of a category that has children → 409', async () => {
      // topLevelCategoryId has subCategoryId as a child
      const res = await request(app.getHttpServer())
        .delete(`/api/labor/categories/${topLevelCategoryId}`)
        .set('x-api-key', 'test-api-key')
        .expect(409);

      expect(res.body.message).toContain('child');
    });

    it('should reject deletion of a category that has operations → 409', async () => {
      // Create a standalone category and attach an operation to it
      const catRes = await request(app.getHttpServer())
        .post('/api/labor/categories')
        .set('x-api-key', 'test-api-key')
        .send({ name: 'Category With Operations' })
        .expect(201);
      const catId = catRes.body.id;

      await request(app.getHttpServer())
        .post('/api/labor/operations')
        .set('x-api-key', 'test-api-key')
        .send({
          code: 'OP-GUARD-001',
          description: 'Guard test operation',
          standardAw: 1.0,
          hourlyRate: 75.0,
          categoryId: catId,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .delete(`/api/labor/categories/${catId}`)
        .set('x-api-key', 'test-api-key')
        .expect(409);

      expect(res.body.message).toContain('operation');
    });

    it('should delete an empty category → 200', async () => {
      const catRes = await request(app.getHttpServer())
        .post('/api/labor/categories')
        .set('x-api-key', 'test-api-key')
        .send({ name: 'Empty Category To Delete' })
        .expect(201);
      categoryForDeletionId = catRes.body.id;

      const res = await request(app.getHttpServer())
        .delete(`/api/labor/categories/${categoryForDeletionId}`)
        .set('x-api-key', 'test-api-key')
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
        .set('x-api-key', 'test-api-key')
        .send({ name: 'Transmission' })
        .expect(201);
      categoryId = catRes.body.id;
    });

    it('should create an operation with all fields → 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/labor/operations')
        .set('x-api-key', 'test-api-key')
        .send({
          code: 'TR-001',
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
        code: 'TR-001',
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
        .set('x-api-key', 'test-api-key')
        .send({
          code: 'TR-001',
          description: 'Duplicate code attempt',
          standardAw: 1.0,
          hourlyRate: 50.0,
        })
        .expect(409);

      expect(res.body.message).toContain('already exists');
    });

    it('should update an operation → 200', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/labor/operations/${operationId}`)
        .set('x-api-key', 'test-api-key')
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
        .set('x-api-key', 'test-api-key')
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
        .set('x-api-key', 'test-api-key')
        .expect(200);

      expect(res.body).toMatchObject({ id: operationId, isActive: false });
    });

    it('should list operations filtered by isActive=false → returns soft-deleted', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/labor/operations?isActive=false')
        .set('x-api-key', 'test-api-key')
        .expect(200);

      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('meta');
      const found = res.body.data.find((op: any) => op.id === operationId);
      expect(found).toBeDefined();
      expect(found.isActive).toBe(false);
    });

    it('should list operations filtered by isActive=true → excludes soft-deleted', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/labor/operations?isActive=true')
        .set('x-api-key', 'test-api-key')
        .expect(200);

      const found = res.body.data.find((op: any) => op.id === operationId);
      expect(found).toBeUndefined();
    });

    it('should list operations filtered by categoryId', async () => {
      // Create an active operation in the category
      const opRes = await request(app.getHttpServer())
        .post('/api/labor/operations')
        .set('x-api-key', 'test-api-key')
        .send({
          code: 'TR-CAT-001',
          description: 'Category filter test',
          standardAw: 2.0,
          hourlyRate: 75.0,
          categoryId,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/labor/operations?categoryId=${categoryId}`)
        .set('x-api-key', 'test-api-key')
        .expect(200);

      expect(res.body.data.length).toBeGreaterThan(0);
      res.body.data.forEach((op: any) => {
        expect(op.categoryId).toBe(categoryId);
      });

      // Cleanup
      await prisma.laborOperation.delete({ where: { id: opRes.body.id } });
    });

    it('search endpoint should exclude inactive operations', async () => {
      // Create a vehicle, customer, and workshop order for the search endpoint
      const vehicle = await prisma.vehicle.create({
        data: {
          vin: `LABOR-TEST-${Date.now()}`,
          make: 'Toyota',
          model: 'Corolla',
          year: 2020,
        },
      });

      const customer = await prisma.customer.create({
        data: {
          first_name: 'Labor',
          last_name: 'Tester',
          email: `labor-${Date.now()}@test.com`,
        },
      });

      const workshopOrder = await prisma.workshopOrder.create({
        data: {
          customer_id: customer.id,
          vehicle_id: vehicle.id,
          order_number: `WO-LABOR-${Date.now()}`,
          status: 'INTAKE',
          odometer: 0,
          fuel_level: 50,
        },
      });

      // Create an active operation matching the search term
      const activeOp = await prisma.laborOperation.create({
        data: {
          code: `SRCH-ACTIVE-${Date.now()}`,
          description: 'SearchTerm Active Op',
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

      // Create an inactive operation with the same description
      const inactiveOp = await prisma.laborOperation.create({
        data: {
          code: `SRCH-INACTIVE-${Date.now()}`,
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

      const res = await request(app.getHttpServer())
        .get(
          `/api/labor/search?q=SearchTerm&workshopOrderId=${workshopOrder.id}`,
        )
        .set('x-api-key', 'test-api-key')
        .expect(200);

      const ids = res.body.data.map((op: any) => op.id);
      expect(ids).toContain(activeOp.id);
      expect(ids).not.toContain(inactiveOp.id);

      // Cleanup
      await prisma.laborFitment.deleteMany({
        where: {
          labor_operation_id: { in: [activeOp.id, inactiveOp.id] },
        },
      });
      await prisma.laborOperation.deleteMany({
        where: { id: { in: [activeOp.id, inactiveOp.id] } },
      });
      await prisma.workshopOrder.delete({ where: { id: workshopOrder.id } });
      await prisma.vehicle.delete({ where: { id: vehicle.id } });
      await prisma.customer.delete({ where: { id: customer.id } });
    });
  });
});
