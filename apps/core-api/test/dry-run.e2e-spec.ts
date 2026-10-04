import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import {
  SideEffectGuard,
  DryRunSideEffectBlockedException,
} from '../src/dry-run/side-effect-guard.js';
import { DryRunStorage } from '../src/dry-run/dry-run.storage.js';
import {
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  cleanupTestTenantGraph,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('Dry-run support on state-changing endpoints (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;

  let tenantA: string;
  let tenantB: string;
  let adminHeaderA: string;
  let adminHeaderB: string;
  let techHeaderA: string;
  let prismaA: PrismaService;
  let prismaB: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
    authService = app.get(AuthService);

    const tenantResA = await createTestTenant(prisma, 'dry-run-tenant-a');
    const tenantResB = await createTestTenant(prisma, 'dry-run-tenant-b');
    tenantA = tenantResA.tenantId;
    tenantB = tenantResB.tenantId;

    prismaA = createTenantAwarePrisma(prisma, tenantA);
    prismaB = createTenantAwarePrisma(prisma, tenantB);

    adminHeaderA = `Bearer ${createTestAuthToken(authService, tenantResA, {
      role: 'ADMIN',
    })}`;
    adminHeaderB = `Bearer ${createTestAuthToken(authService, tenantResB, {
      role: 'ADMIN',
    })}`;
    techHeaderA = `Bearer ${createTestAuthToken(authService, tenantResA, {
      role: 'TECH',
    })}`;
  });

  afterAll(async () => {
    if (tenantA) {
      await cleanupTestTenantGraph(prisma, tenantA);
    }
    if (tenantB) {
      await cleanupTestTenantGraph(prisma, tenantB);
    }
    if (app) {
      await teardownTestApp(app, prisma);
    }
  });

  describe('Before/After zero persistence verification on supported endpoints', () => {
    it('dry-runs create customer: returns would_change, preview payload, and persists zero rows', async () => {
      const customersBefore = await prismaA.customer.count({
        where: { tenant_id: tenantA },
      });
      const auditBefore = await prisma.auditLog.count({
        where: { tenant_id: tenantA },
      });

      const customerPayload = {
        type: 'PRIVATE',
        first_name: 'Pilot',
        last_name: 'Tester',
        email: `dryrun-cust-${Date.now()}@example.com`,
      };

      const res = await request(app.getHttpServer())
        .post('/api/customers?dry_run=true')
        .set('Authorization', adminHeaderA)
        .send(customerPayload)
        .expect(201);

      expect(res.headers['x-dry-run']).toBe('true');
      expect(res.body.dry_run).toBe(true);
      expect(res.body.first_name).toBe('Pilot');
      expect(res.body.last_name).toBe('Tester');
      expect(Array.isArray(res.body.would_change)).toBe(true);
      expect(res.body.would_change).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            entity: 'Customer',
            op: 'create',
          }),
        ]),
      );

      // Verify ZERO rows were persisted in Customer and AuditLog
      const customersAfter = await prismaA.customer.count({
        where: { tenant_id: tenantA },
      });
      const auditAfter = await prisma.auditLog.count({
        where: { tenant_id: tenantA },
      });

      expect(customersAfter).toBe(customersBefore);
      expect(auditAfter).toBe(auditBefore);
    });

    it('dry-runs create vehicle: returns preview payload and persists zero rows', async () => {
      const vehiclesBefore = await prismaA.vehicle.count({
        where: { tenant_id: tenantA },
      });
      const auditBefore = await prisma.auditLog.count({
        where: { tenant_id: tenantA },
      });

      const vinSuffix = Math.floor(100000 + Math.random() * 900000);
      const vehiclePayload = {
        vin: `WAUZZZ8V${vinSuffix}`,
        make: 'Audi',
        model: 'A3',
        year: 2022,
      };

      const res = await request(app.getHttpServer())
        .post('/api/vehicles?dry_run=true')
        .set('Authorization', adminHeaderA)
        .send(vehiclePayload)
        .expect(201);

      expect(res.headers['x-dry-run']).toBe('true');
      expect(res.body.dry_run).toBe(true);
      expect(res.body.vin).toBe(vehiclePayload.vin);
      expect(res.body.would_change).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            entity: 'Vehicle',
            op: 'create',
          }),
        ]),
      );

      const vehiclesAfter = await prismaA.vehicle.count({
        where: { tenant_id: tenantA },
      });
      const auditAfter = await prisma.auditLog.count({
        where: { tenant_id: tenantA },
      });

      expect(vehiclesAfter).toBe(vehiclesBefore);
      expect(auditAfter).toBe(auditBefore);
    });

    it('dry-runs create workshop order: does not burn numbering sequences or persist tasks/orders', async () => {
      // Create a customer and vehicle to link to the workshop order
      const customer = await prismaA.customer.create({
        data: {
          first_name: 'Order',
          last_name: 'Customer',
          email: `order-cust-${Date.now()}@example.com`,
          tenant_id: tenantA,
        },
      });

      const vehicle = await prismaA.vehicle.create({
        data: {
          vin: `WBA12345${Date.now()}`.slice(0, 17),
          make: 'BMW',
          model: '320d',
          year: 2021,
          customer_id: customer.id,
          tenant_id: tenantA,
        },
      });

      const ordersBefore = await prismaA.workshopOrder.count({
        where: { tenant_id: tenantA },
      });
      const tasksBefore = await prismaA.workshopTask.count({
        where: { tenant_id: tenantA },
      });
      const auditBefore = await prisma.auditLog.count({
        where: { tenant_id: tenantA },
      });

      const financeSettingsBefore = await prisma.financeSettings.findFirst({
        where: { tenant_id: tenantA },
      });
      const seqBefore = financeSettingsBefore?.next_workshop_order_number ?? 1;

      const orderPayload = {
        customerId: customer.id,
        vehicleId: vehicle.id,
        odometer: 125000,
        description: 'Inspection and brake check',
      };

      const res = await request(app.getHttpServer())
        .post('/api/workshop/orders?dry_run=true')
        .set('Authorization', adminHeaderA)
        .send(orderPayload)
        .expect(201);

      expect(res.headers['x-dry-run']).toBe('true');
      expect(res.body.dry_run).toBe(true);
      expect(res.body.customer_id).toBe(customer.id);
      expect(res.body.vehicle_id).toBe(vehicle.id);
      expect(res.body.would_change).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            entity: 'WorkshopOrder',
            op: 'create',
          }),
        ]),
      );

      // Verify ZERO changes in DB and NO numbering sequence burned
      const ordersAfter = await prismaA.workshopOrder.count({
        where: { tenant_id: tenantA },
      });
      const tasksAfter = await prismaA.workshopTask.count({
        where: { tenant_id: tenantA },
      });
      const auditAfter = await prisma.auditLog.count({
        where: { tenant_id: tenantA },
      });
      const financeSettingsAfter = await prisma.financeSettings.findFirst({
        where: { tenant_id: tenantA },
      });
      const seqAfter = financeSettingsAfter?.next_workshop_order_number ?? 1;

      expect(ordersAfter).toBe(ordersBefore);
      expect(tasksAfter).toBe(tasksBefore);
      expect(auditAfter).toBe(auditBefore);
      expect(seqAfter).toBe(seqBefore);
    });

    it('dry-runs patch workshop order line items: returns would-be items and preserves line version in DB', async () => {
      // Live-create a workshop order with one task
      const cust = await prismaA.customer.create({
        data: {
          first_name: 'Line',
          last_name: 'Tester',
          email: `line-cust-${Date.now()}@example.com`,
          tenant_id: tenantA,
        },
      });
      const veh = await prismaA.vehicle.create({
        data: {
          vin: `WVW12345${Date.now()}`.slice(0, 17),
          make: 'VW',
          model: 'Golf',
          year: 2020,
          customer_id: cust.id,
          tenant_id: tenantA,
        },
      });

      const liveOrderRes = await request(app.getHttpServer())
        .post('/api/workshop/orders')
        .set('Authorization', adminHeaderA)
        .send({
          customerId: cust.id,
          vehicleId: veh.id,
          odometer: 85000,
        })
        .expect(201);

      const orderId = liveOrderRes.body.id;

      // Add a task
      const taskRes = await request(app.getHttpServer())
        .post(`/api/workshop/orders/${orderId}/tasks`)
        .set('Authorization', adminHeaderA)
        .send({ title: 'Oil Service' })
        .expect(201);

      const taskId = taskRes.body.id;

      const linesBefore = await prismaA.workshopTaskLineItem.count({
        where: { task_id: taskId },
      });
      const taskBefore = await prismaA.workshopTask.findUniqueOrThrow({
        where: { id: taskId },
      });
      const versionBefore = taskBefore.line_items_version;

      const patchPayload = {
        expectedLineItemsVersion: versionBefore,
        items: [
          {
            type: 'PART',
            itemNo: 'OIL-5W30',
            description: 'Synthetic Engine Oil 5W30',
            qty: 4.5,
            unitPrice: 22.5,
          },
          {
            type: 'LABOR',
            itemNo: 'LAB-OIL',
            description: 'Oil replacement labor',
            qty: 1,
            unitPrice: 85,
          },
        ],
      };

      const res = await request(app.getHttpServer())
        .patch(
          `/api/workshop/orders/${orderId}/tasks/${taskId}/line-items?dry_run=true`,
        )
        .set('Authorization', adminHeaderA)
        .send(patchPayload)
        .expect(200);

      expect(res.headers['x-dry-run']).toBe('true');
      expect(res.body.dry_run).toBe(true);
      expect(res.body.would_change).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            entity: 'WorkshopTaskLineItem',
            op: 'create',
          }),
        ]),
      );

      // Verify DB state was NOT modified: line item count & version untouched
      const linesAfter = await prismaA.workshopTaskLineItem.count({
        where: { task_id: taskId },
      });
      const taskAfter = await prismaA.workshopTask.findUniqueOrThrow({
        where: { id: taskId },
      });

      expect(linesAfter).toBe(linesBefore);
      expect(taskAfter.line_items_version).toBe(versionBefore);
    });
  });

  describe('Side-effect guard loud failure', () => {
    it('fails loudly when attempting blocked outbound side effects during dry run', () => {
      DryRunStorage.run({ isDryRun: true }, () => {
        expect(() => SideEffectGuard.assertAllowed('QUEUE_ENQUEUE')).toThrow(
          DryRunSideEffectBlockedException,
        );
        expect(() => SideEffectGuard.assertAllowed('EMAIL')).toThrow(
          DryRunSideEffectBlockedException,
        );
        expect(() => SideEffectGuard.assertAllowed('SMS')).toThrow(
          DryRunSideEffectBlockedException,
        );
        expect(() => SideEffectGuard.assertAllowed('NOTIFICATION')).toThrow(
          DryRunSideEffectBlockedException,
        );
        expect(() => SideEffectGuard.assertAllowed('FILE_WRITE')).toThrow(
          DryRunSideEffectBlockedException,
        );
        expect(() => SideEffectGuard.assertAllowed('GCS_WRITE')).toThrow(
          DryRunSideEffectBlockedException,
        );
        expect(() => SideEffectGuard.assertAllowed('EXTERNAL_HTTP')).toThrow(
          DryRunSideEffectBlockedException,
        );
        expect(() => SideEffectGuard.assertAllowed('PERSISTED_AUDIT')).toThrow(
          DryRunSideEffectBlockedException,
        );
      });
    });
  });

  describe('Refusal of dry run on unsupported and fiscal sequence endpoints', () => {
    it('returns 400 DRY_RUN_NOT_SUPPORTED on invoice finalize', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/sales/invoices/00000000-0000-0000-0000-000000000001/finalize?dry_run=true')
        .set('Authorization', adminHeaderA)
        .expect(400);

      expect(res.body.code).toBe('DRY_RUN_NOT_SUPPORTED');
    });

    it('returns 400 DRY_RUN_NOT_SUPPORTED on credit note finalize', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/credit-notes/00000000-0000-0000-0000-000000000001/finalize?dry_run=true')
        .set('Authorization', adminHeaderA)
        .send({ invoice_id: '00000000-0000-0000-0000-000000000001' })
        .expect(400);

      expect(res.body.code).toBe('DRY_RUN_NOT_SUPPORTED');
    });

    it('returns 400 DRY_RUN_NOT_SUPPORTED on accounting export generation', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/finance/accounting-exports?dry_run=true')
        .set('Authorization', adminHeaderA)
        .send({
          legal_entity_id: '00000000-0000-0000-0000-000000000001',
          date_from: '2026-01-01',
          date_to: '2026-01-31',
        })
        .expect(400);

      expect(res.body.code).toBe('DRY_RUN_NOT_SUPPORTED');
    });

    it('returns 400 DRY_RUN_NOT_SUPPORTED on any general unannotated endpoint', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/brands?dry_run=true')
        .set('Authorization', adminHeaderA)
        .send({ name: 'Test Brand' })
        .expect(400);

      expect(res.body.code).toBe('DRY_RUN_NOT_SUPPORTED');
    });
  });

  describe('Tenant isolation and RBAC parity', () => {
    it('rejects unauthenticated dry-run requests with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/customers?dry_run=true')
        .send({
          type: 'PRIVATE',
          first_name: 'No',
          last_name: 'Auth',
        })
        .expect(401);
    });

    it('enforces tenant isolation: dry-run cannot link cross-tenant customer', async () => {
      // Create customer in Tenant B
      const custB = await prismaB.customer.create({
        data: {
          first_name: 'TenantB',
          last_name: 'Customer',
          email: `cust-b-${Date.now()}@example.com`,
          tenant_id: tenantB,
        },
      });

      // Attempt to dry-run create vehicle in Tenant A referencing Tenant B customer
      await request(app.getHttpServer())
        .post('/api/vehicles?dry_run=true')
        .set('Authorization', adminHeaderA)
        .send({
          vin: `WVW99999${Date.now()}`.slice(0, 17),
          make: 'Audi',
          model: 'A4',
          year: 2021,
          customer_id: custB.id,
        })
        .expect(404);
    });
  });

  describe('Live non-dry-run behavior unchanged', () => {
    it('persists data and does not return dry-run fields when dry_run flag is omitted', async () => {
      const email = `live-cust-${Date.now()}@example.com`;
      const res = await request(app.getHttpServer())
        .post('/api/customers')
        .set('Authorization', adminHeaderA)
        .send({
          type: 'PRIVATE',
          first_name: 'Live',
          last_name: 'Customer',
          email,
        })
        .expect(201);

      expect(res.headers['x-dry-run']).toBeUndefined();
      expect(res.body.dry_run).toBeUndefined();
      expect(res.body.would_change).toBeUndefined();

      const created = await prismaA.customer.findFirst({
        where: { email, tenant_id: tenantA },
      });
      expect(created).not.toBeNull();
      expect(created?.id).toBe(res.body.id);
    });
  });
});
