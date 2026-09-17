import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('Operational Document Retarget (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;

  let tenant: TestTenantResult;
  let tenantPrisma: ReturnType<typeof createTenantAwarePrisma>;

  let siteA: { id: string };
  let siteB: { id: string };
  let siteInactive: { id: string };

  let userAOnlyToken: string;
  let userBothSitesToken: string;

  let customerId: string;
  let vehicleId: string;
  let vendorId: string;
  let catalogItemId: string;
  let baySiteA: { id: string };
  let baySiteB: { id: string };
  let lotSiteA: { id: string };
  let lotSiteB: { id: string };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    authService = app.get<AuthService>(AuthService);

    tenant = await createTestTenant(prisma, 'doc-retarget');
    tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);

    // Fetch primary MAIN site created by test utility
    siteA = await tenantPrisma.site.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId, code: 'MAIN' },
    });

    const legalEntity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId },
    });

    // Create Site B (active)
    siteB = await tenantPrisma.site.create({
      data: {
        tenant_id: tenant.tenantId,
        legal_entity_id: legalEntity.id,
        code: 'SITE-B',
        name: 'Site B',
        timezone: 'Europe/Vienna',
        slot_minutes: 30,
        holiday_country_iso: 'AT',
        is_active: true,
      },
    });

    // Create Inactive Site
    siteInactive = await tenantPrisma.site.create({
      data: {
        tenant_id: tenant.tenantId,
        legal_entity_id: legalEntity.id,
        code: 'INACTIVE',
        name: 'Inactive Site',
        timezone: 'Europe/Vienna',
        slot_minutes: 30,
        holiday_country_iso: 'AT',
        is_active: false,
      },
    });

    // Lots for Site A and Site B
    lotSiteA = await tenantPrisma.storageLocation.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId, site_id: siteA.id, type: 'vehicle_lot' },
    });

    lotSiteB = await tenantPrisma.storageLocation.create({
      data: {
        tenant_id: tenant.tenantId,
        site_id: siteB.id,
        code: 'LOT-B',
        name: 'Vehicle Lot B',
        type: 'vehicle_lot',
        is_system: false,
      },
    });

    // Bays for Site A and Site B
    baySiteA = await tenantPrisma.bay.create({
      data: {
        tenant_id: tenant.tenantId,
        site_id: siteA.id,
        name: 'Bay A1',
      },
    });

    baySiteB = await tenantPrisma.bay.create({
      data: {
        tenant_id: tenant.tenantId,
        site_id: siteB.id,
        name: 'Bay B1',
      },
    });

    // User 1: member of Site A ONLY
    const userA = await prisma.user.create({
      data: {
        firebaseUid: 'uid-user-a-' + tenant.tenantId,
        email: 'usera-' + tenant.tenantId + '@example.com',
        active_tenant_id: tenant.tenantId,
        active_site_id: siteA.id,
        memberships: {
          create: {
            tenant_id: tenant.tenantId,
            role: 'ADMIN',
            is_active: true,
          },
        },
        siteMemberships: {
          create: {
            tenant_id: tenant.tenantId,
            site_id: siteA.id,
            is_active: true,
          },
        },
      },
    });
    userAOnlyToken = createTestAuthToken(authService, {
      ...tenant,
      firebaseUid: userA.firebaseUid,
      email: userA.email,
    });

    // User 2: member of Site A AND Site B
    const userBoth = await prisma.user.create({
      data: {
        firebaseUid: 'uid-user-both-' + tenant.tenantId,
        email: 'userboth-' + tenant.tenantId + '@example.com',
        active_tenant_id: tenant.tenantId,
        active_site_id: siteA.id,
        memberships: {
          create: {
            tenant_id: tenant.tenantId,
            role: 'ADMIN',
            is_active: true,
          },
        },
        siteMemberships: {
          createMany: {
            data: [
              { tenant_id: tenant.tenantId, site_id: siteA.id, is_active: true },
              { tenant_id: tenant.tenantId, site_id: siteB.id, is_active: true },
            ],
          },
        },
      },
    });
    userBothSitesToken = createTestAuthToken(authService, {
      ...tenant,
      firebaseUid: userBoth.firebaseUid,
      email: userBoth.email,
    });

    // Create shared customer, vehicle, vendor, catalog item
    const customer = await tenantPrisma.customer.create({
      data: {
        first_name: 'Jane',
        last_name: 'Doe',
        email: 'jane.doe@example.com',
        type: 'PRIVATE',
      },
    });
    customerId = customer.id;

    const vehicle = await tenantPrisma.vehicle.create({
      data: {
        customer_id: customerId,
        make: 'Audi',
        model: 'A4',
        year: 2022,
        vin: 'WAUZZZ8K0DA000001',
        plate: 'W-9999AA',
      },
    });
    vehicleId = vehicle.id;

    const vendor = await tenantPrisma.vendor.create({
      data: {
        name: 'Auto Parts Ltd',
        email: 'parts@example.com',
        account_number: 'VEND-001',
      },
    });
    vendorId = vendor.id;

    const catalogItem = await tenantPrisma.catalogItem.create({
      data: {
        sku: `OIL-FILTER-${tenant.tenantId.slice(0, 8)}`,
        name: 'Synthetic Oil Filter',
        cost_price: 15.0,
        retail_price: 30.0,
      },
    });
    catalogItemId = catalogItem.id;

    const year = new Date().getFullYear();
    const orderPrefix = `${tenant.tenantId.slice(0, 8)}-`;
    await tenantPrisma.financeSettings.create({
      data: {
        tenant_id: tenant.tenantId,
        fiscal_year_start_month: 1,
        lock_date: null,
        next_invoice_number: 1001,
        invoice_prefix: `RE-${orderPrefix}`,
        next_sales_order_number: 1001,
        sales_order_prefix: `SO-${year}-${orderPrefix}`,
        next_workshop_order_number: 1,
        workshop_order_prefix: `WO-${year}-${orderPrefix}`,
      },
    });
  });

  afterAll(async () => {
    if (tenant?.tenantId) {
      await cleanupTestTenantGraph(prisma, tenant.tenantId).catch(() => undefined);
    }
    await teardownTestApp(app, prisma);
  });

  let scheduledSlotIndex = 0;

  async function createScheduledWorkshopOrder(token: string) {
    const slot = scheduledSlotIndex++;
    const hour = 8 + (slot % 10);
    const vehicle = await tenantPrisma.vehicle.create({
      data: {
        customer_id: customerId,
        make: 'Audi',
        model: 'A4',
        year: 2022,
        vin: `WAUZZZ8K0DA${String(100000 + slot).padStart(6, '0')}`,
        plate: `W-${String(1000 + slot).padStart(4, '0')}ZZ`,
      },
    });
    const start = new Date(`2026-09-20T${String(hour).padStart(2, '0')}:00:00.000Z`);
    const end = new Date(`2026-09-20T${String(hour).padStart(2, '0')}:30:00.000Z`);

    return await request(app.getHttpServer())
      .post('/api/workshop/orders')
      .set('Authorization', 'Bearer ' + token)
      .send({
        customerId,
        vehicleId: vehicle.id,
        status: 'SCHEDULED',
        bayId: baySiteA.id,
        scheduledStartAt: start.toISOString(),
        scheduledEndAt: end.toISOString(),
      })
      .expect(201);
  }

  describe('WorkshopOrder Stamping & Retargeting', () => {
    it('stamps site_id from active site upon creation', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/workshop/orders')
        .set('Authorization', 'Bearer ' + userAOnlyToken)
        .send({
          customerId,
          vehicleId,
          odometer: 15000,
          fuelLevel: 50,
          notes: 'Regular service',
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.site_id).toBe(siteA.id);
    });

    it('rejects retargeting when caller lacks membership on target site (422)', async () => {
      const createRes = await createScheduledWorkshopOrder(userAOnlyToken);

      await request(app.getHttpServer())
        .patch('/api/workshop/orders/' + createRes.body.id)
        .set('Authorization', 'Bearer ' + userAOnlyToken)
        .send({
          siteId: siteB.id,
          expectedSiteId: siteA.id,
          bayId: baySiteB.id,
        })
        .expect(422);
    });

    it('rejects retargeting if bay belongs to source site (422)', async () => {
      const createRes = await createScheduledWorkshopOrder(userBothSitesToken);

      await request(app.getHttpServer())
        .patch('/api/workshop/orders/' + createRes.body.id)
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .send({
          siteId: siteB.id,
          expectedSiteId: siteA.id,
          bayId: baySiteA.id,
        })
        .expect(422);
    });

    it('rejects retargeting on stale expectedSiteId (409)', async () => {
      const createRes = await createScheduledWorkshopOrder(userBothSitesToken);

      await request(app.getHttpServer())
        .patch('/api/workshop/orders/' + createRes.body.id)
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .send({
          siteId: siteB.id,
          expectedSiteId: siteB.id,
          bayId: baySiteB.id,
        })
        .expect(409);
    });

    it('successfully retargets in SCHEDULED status when authorized', async () => {
      const createRes = await createScheduledWorkshopOrder(userBothSitesToken);

      const retargetRes = await request(app.getHttpServer())
        .patch('/api/workshop/orders/' + createRes.body.id)
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .send({
          siteId: siteB.id,
          expectedSiteId: siteA.id,
          bayId: baySiteB.id,
        })
        .expect(200);

      expect(retargetRes.body.site_id).toBe(siteB.id);
      expect(retargetRes.body.bay_id).toBe(baySiteB.id);
    });
  });

  describe('SalesOrder Stamping & Retargeting', () => {
    it('stamps site_id upon creation and retargets when in DRAFT', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/sales-orders')
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .send({
          customer_id: customerId,
          items: [
            {
              catalog_item_id: catalogItemId,
              description: 'Synthetic Oil Filter',
              quantity: 2,
              unit_price: 30,
              tax_rate: 20,
            },
          ],
        })
        .expect(201);

      expect(createRes.body.site_id).toBe(siteA.id);

      const patchRes = await request(app.getHttpServer())
        .patch('/api/sales-orders/' + createRes.body.id)
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .send({
          siteId: siteB.id,
          expectedSiteId: siteA.id,
        })
        .expect(200);

      expect(patchRes.body.site_id).toBe(siteB.id);
    });

    it('rejects retargeting when user lacks membership on target site (422)', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/sales-orders')
        .set('Authorization', 'Bearer ' + userAOnlyToken)
        .send({
          customer_id: customerId,
          items: [
            {
              catalog_item_id: catalogItemId,
              description: 'Synthetic Oil Filter',
              quantity: 1,
              unit_price: 30,
              tax_rate: 20,
            },
          ],
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch('/api/sales-orders/' + createRes.body.id)
        .set('Authorization', 'Bearer ' + userAOnlyToken)
        .send({
          siteId: siteB.id,
          expectedSiteId: siteA.id,
        })
        .expect(422);
    });

    it('rejects retargeting when target site is inactive (422)', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/sales-orders')
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .send({
          customer_id: customerId,
          items: [
            {
              catalog_item_id: catalogItemId,
              description: 'Synthetic Oil Filter',
              quantity: 1,
              unit_price: 30,
              tax_rate: 20,
            },
          ],
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch('/api/sales-orders/' + createRes.body.id)
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .send({
          siteId: siteInactive.id,
          expectedSiteId: siteA.id,
        })
        .expect(422);
    });
  });

  describe('PurchaseOrder Stamping & Retargeting', () => {
    it('stamps site_id upon creation and retargets when in DRAFT', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/purchase-orders')
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .send({
          vendorId,
          items: [{ catalogItemId, quantity: 10, unitCost: 15 }],
        })
        .expect(201);

      expect(createRes.body.site_id).toBe(siteA.id);

      const patchRes = await request(app.getHttpServer())
        .patch('/api/purchase-orders/' + createRes.body.id)
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .send({
          siteId: siteB.id,
          expectedSiteId: siteA.id,
        })
        .expect(200);

      expect(patchRes.body.site_id).toBe(siteB.id);
    });

    it('rejects retargeting when order is SENT / beyond DRAFT (422)', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/purchase-orders')
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .send({
          vendorId,
          items: [{ catalogItemId, quantity: 5, unitCost: 15 }],
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/purchase-orders/' + createRes.body.id + '/mark-as-sent')
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .expect(200);

      await request(app.getHttpServer())
        .patch('/api/purchase-orders/' + createRes.body.id)
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .send({
          siteId: siteB.id,
          expectedSiteId: siteA.id,
        })
        .expect(422);
    });
  });

  describe('VehiclePurchase Stamping & Retargeting', () => {
    it('stamps site_id upon creation and retargets with new lot location', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/vehicle-purchases')
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .send({
          seller_type: 'VENDOR',
          vendor_id: vendorId,
          vin: 'WAUZZZ8K0DA999111',
          make: 'Audi',
          model: 'A6',
          year: 2021,
          purchase_price: 25000,
        })
        .expect(201);

      expect(createRes.body.site_id).toBe(siteA.id);

      const patchRes = await request(app.getHttpServer())
        .patch('/api/vehicle-purchases/' + createRes.body.id)
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .send({
          site_id: siteB.id,
          expectedSiteId: siteA.id,
          location_id: lotSiteB.id,
        })
        .expect(200);

      expect(patchRes.body.site_id).toBe(siteB.id);
      expect(patchRes.body.location_id).toBe(lotSiteB.id);
    });

    it('rejects retargeting if location_id belongs to source site (422)', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/vehicle-purchases')
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .send({
          seller_type: 'VENDOR',
          vendor_id: vendorId,
          vin: 'WAUZZZ8K0DA999222',
          make: 'Audi',
          model: 'A6',
          year: 2021,
          purchase_price: 25000,
          location_id: lotSiteA.id,
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch('/api/vehicle-purchases/' + createRes.body.id)
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .send({
          site_id: siteB.id,
          expectedSiteId: siteA.id,
        })
        .expect(422);
    });
  });

  describe('Freeze boundaries and concurrency', () => {
    it('rejects sales order retarget after CONFIRMED (422)', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/sales-orders')
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .send({
          customer_id: customerId,
          items: [
            {
              catalog_item_id: catalogItemId,
              description: 'Synthetic Oil Filter',
              quantity: 1,
              unit_price: 30,
              tax_rate: 20,
            },
          ],
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch('/api/sales-orders/' + createRes.body.id)
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .send({ status: 'CONFIRMED' })
        .expect(200);

      await request(app.getHttpServer())
        .patch('/api/sales-orders/' + createRes.body.id)
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .send({
          siteId: siteB.id,
          expectedSiteId: siteA.id,
        })
        .expect(422);
    });

    it('returns 409 when confirm races retarget on the same sales order', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/sales-orders')
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .send({
          customer_id: customerId,
          items: [
            {
              catalog_item_id: catalogItemId,
              description: 'Synthetic Oil Filter',
              quantity: 1,
              unit_price: 30,
              tax_rate: 20,
            },
          ],
        })
        .expect(201);

      const [confirmRes, retargetRes] = await Promise.all([
        request(app.getHttpServer())
          .patch('/api/sales-orders/' + createRes.body.id)
          .set('Authorization', 'Bearer ' + userBothSitesToken)
          .send({ status: 'CONFIRMED' }),
        request(app.getHttpServer())
          .patch('/api/sales-orders/' + createRes.body.id)
          .set('Authorization', 'Bearer ' + userBothSitesToken)
          .send({
            siteId: siteB.id,
            expectedSiteId: siteA.id,
          }),
      ]);

      const statuses = [confirmRes.status, retargetRes.status].sort();
      expect(statuses).toEqual([200, 409]);
    });

    it('rejects workshop retarget after INTAKE promotion (422)', async () => {
      const scheduled = await createScheduledWorkshopOrder(userBothSitesToken);

      await request(app.getHttpServer())
        .post('/api/workshop/orders')
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .send({
          customerId,
          vehicleId: scheduled.body.vehicle_id,
          odometer: 12000,
          fuelLevel: 60,
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch('/api/workshop/orders/' + scheduled.body.id)
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .send({
          siteId: siteB.id,
          expectedSiteId: siteA.id,
          bayId: baySiteB.id,
        })
        .expect(422);
    });

    it('rejects vehicle purchase retarget after RECEIVED (422)', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/vehicle-purchases')
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .send({
          seller_type: 'VENDOR',
          vendor_id: vendorId,
          vin: 'WAUZZZ8K0DA999333',
          make: 'Audi',
          model: 'A6',
          year: 2021,
          purchase_price: 25000,
          location_id: lotSiteA.id,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/vehicle-purchases/' + createRes.body.id + '/receive')
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .expect(201);

      await request(app.getHttpServer())
        .patch('/api/vehicle-purchases/' + createRes.body.id)
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .send({
          site_id: siteB.id,
          expectedSiteId: siteA.id,
          location_id: lotSiteB.id,
        })
        .expect(422);
    });
  });

  describe('Active site switcher does not rewrite document site', () => {
    it('retarget uses persisted site_id after switching active site to target', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/sales-orders')
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .send({
          customer_id: customerId,
          items: [
            {
              catalog_item_id: catalogItemId,
              description: 'Synthetic Oil Filter',
              quantity: 1,
              unit_price: 30,
              tax_rate: 20,
            },
          ],
        })
        .expect(201);

      expect(createRes.body.site_id).toBe(siteA.id);

      await request(app.getHttpServer())
        .patch('/api/me/active-site')
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .send({ siteId: siteB.id })
        .expect(200);

      const getRes = await request(app.getHttpServer())
        .get('/api/sales-orders/' + createRes.body.id)
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .expect(200);

      expect(getRes.body.site_id).toBe(siteA.id);

      const retargetRes = await request(app.getHttpServer())
        .patch('/api/sales-orders/' + createRes.body.id)
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .send({
          siteId: siteB.id,
          expectedSiteId: siteA.id,
        })
        .expect(200);

      expect(retargetRes.body.site_id).toBe(siteB.id);

      await request(app.getHttpServer())
        .patch('/api/me/active-site')
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .send({ siteId: siteA.id })
        .expect(200);
    });
  });

  describe('Workshop retarget releases parts reservations', () => {
    it('cancels OPEN reservations when retargeting a SCHEDULED order', async () => {
      const scheduled = await createScheduledWorkshopOrder(userBothSitesToken);
      const orderId = scheduled.body.id;

      const task = await tenantPrisma.workshopTask.create({
        data: {
          workshop_order_id: orderId,
          title: 'Brake service',
        },
      });
      const line = await tenantPrisma.workshopTaskLineItem.create({
        data: {
          workshop_task_id: task.id,
          type: 'PART',
          part_execution_status: 'PENDING_PICK',
          item_no: 'PART-RETARGET',
          description: 'Brake pad',
          quantity: 1,
          unit_price: 20,
          catalog_item_id: catalogItemId,
        },
      });
      const reservation = await tenantPrisma.partsReservation.create({
        data: {
          tenant_id: tenant.tenantId,
          workshop_task_line_item_id: line.id,
          status: 'OPEN',
          kind: 'ON_HAND',
          quantity: 1,
        },
      });

      await request(app.getHttpServer())
        .patch('/api/workshop/orders/' + orderId)
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .send({
          siteId: siteB.id,
          expectedSiteId: siteA.id,
          bayId: baySiteB.id,
        })
        .expect(200);

      const released = await tenantPrisma.partsReservation.findFirstOrThrow({
        where: { id: reservation.id },
      });
      expect(released.status).toBe('CANCELLED');
    });
  });

  describe('VehicleSale Stamping & Retargeting', () => {
    it('stamps site_id upon creation and validates parked lot for retargeting', async () => {
      const dealerVehicleA = await tenantPrisma.vehicle.create({
        data: {
          tenant_id: tenant.tenantId,
          make: 'Audi',
          model: 'Q5',
          year: 2023,
          inventory_role: 'USED',
          stock_status: 'IN_STOCK',
          site_id: siteA.id,
          location_id: lotSiteA.id,
        },
      });

      const saleRes = await request(app.getHttpServer())
        .post('/api/vehicle-sales')
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .send({
          vehicle_id: dealerVehicleA.id,
          customer_id: customerId,
          sale_price: 35000,
        })
        .expect(201);

      expect(saleRes.body.site_id).toBe(siteA.id);

      await request(app.getHttpServer())
        .patch('/api/vehicle-sales/' + saleRes.body.id)
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .send({
          site_id: siteB.id,
          expectedSiteId: siteA.id,
        })
        .expect(422);

      await tenantPrisma.vehicle.update({
        where: { id: dealerVehicleA.id },
        data: { site_id: siteB.id, location_id: lotSiteB.id },
      });

      const retargetRes = await request(app.getHttpServer())
        .patch('/api/vehicle-sales/' + saleRes.body.id)
        .set('Authorization', 'Bearer ' + userBothSitesToken)
        .send({
          site_id: siteB.id,
          expectedSiteId: siteA.id,
        })
        .expect(200);

      expect(retargetRes.body.site_id).toBe(siteB.id);
    });
  });
});
