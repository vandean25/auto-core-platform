import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createWorkshopInvoicingSuite,
  createWorkshopVehicle,
  disposeWorkshopInvoicingSuite,
} from './helpers/workshop-invoicing-suite.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestTenant,
  runWithTenantContext,
  seedTestTenantMember,
} from './tenant-test-utils.js';

describe('Workshop free-text PART lines (AUT-972) (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let authToken: string;
  let customerId: string;
  let tenantId: string;

  beforeAll(async () => {
    ({
      app,
      basePrisma,
      prisma,
      tenantId,
      authToken,
      customerId,
    } = await createWorkshopInvoicingSuite());
  });

  afterAll(async () => {
    await disposeWorkshopInvoicingSuite({ app, basePrisma, prisma, tenantId });
  });

  async function createOrderWithTask() {
    const vehicleId = await createWorkshopVehicle(prisma, customerId);
    const orderRes = await request(app.getHttpServer())
      .post('/api/workshop/orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        vehicleId,
        odometer: 88000,
        fuelLevel: 50,
        notes: 'Free-text part scenario',
      })
      .expect(201);

    const taskRes = await request(app.getHttpServer())
      .post(`/api/workshop/orders/${orderRes.body.id}/tasks`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ title: 'General repair' })
      .expect(201);

    return {
      orderId: orderRes.body.id as string,
      taskId: taskRes.body.id as string,
    };
  }

  it('sets free-text PART lines without PENDING_PICK when line items are replaced', async () => {
    const { orderId, taskId } = await createOrderWithTask();

    await request(app.getHttpServer())
      .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}/line-items`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expectedLineItemsVersion: 0,
        items: [
          {
            type: 'LABOR',
            itemNo: 'LAB-90',
            description: 'Work',
            qty: 1,
            unitPrice: 90,
          },
          {
            type: 'PART',
            itemNo: 'MISC-FT',
            description: 'Free-text consumable',
            qty: 1,
            unitPrice: 10,
          },
        ],
      })
      .expect(200);

    const partLine = await prisma.workshopTaskLineItem.findFirstOrThrow({
      where: { workshop_task_id: taskId, type: 'PART' },
      select: { part_execution_status: true, catalog_item_id: true },
    });
    expect(partLine.catalog_item_id).toBeNull();
    expect(partLine.part_execution_status).toBeNull();
  });

  it('allows DONE when the task only has labor and free-text PART lines', async () => {
    const { orderId, taskId } = await createOrderWithTask();

    await request(app.getHttpServer())
      .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}/line-items`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expectedLineItemsVersion: 0,
        items: [
          {
            type: 'LABOR',
            itemNo: 'LAB-90',
            description: 'Work',
            qty: 1,
            unitPrice: 90,
          },
          {
            type: 'PART',
            itemNo: 'MISC-FT',
            description: 'Free-text consumable',
            qty: 1,
            unitPrice: 10,
          },
        ],
      })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'IN_PROGRESS' })
      .expect(200);

    const doneRes = await request(app.getHttpServer())
      .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'DONE' })
      .expect(200);

    expect(
      doneRes.body.tasks.find((task: { id: string }) => task.id === taskId)
        ?.status,
    ).toBe('DONE');
  });

  it('allows draft invoicing when all tasks are DONE with only free-text PART lines', async () => {
    const { orderId, taskId } = await createOrderWithTask();

    await request(app.getHttpServer())
      .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}/line-items`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expectedLineItemsVersion: 0,
        items: [
          {
            type: 'LABOR',
            itemNo: 'LAB-90',
            description: 'Work',
            qty: 1,
            unitPrice: 90,
          },
          {
            type: 'PART',
            itemNo: 'MISC-FT',
            description: 'Free-text consumable',
            qty: 1,
            unitPrice: 10,
          },
        ],
      })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'IN_PROGRESS' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'DONE' })
      .expect(200);

    const invoiceRes = await request(app.getHttpServer())
      .post('/api/invoices/drafts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ workshopOrderId: orderId })
      .expect(201);

    expect(invoiceRes.body.workshop_order_id).toBe(orderId);
    expect(invoiceRes.body.items.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects parts reservation for a free-text PART line with NOT_A_CATALOG_LINE', async () => {
    const { orderId, taskId } = await createOrderWithTask();

    await request(app.getHttpServer())
      .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}/line-items`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expectedLineItemsVersion: 0,
        items: [
          {
            type: 'PART',
            itemNo: 'MISC-FT',
            description: 'Free-text consumable',
            qty: 1,
            unitPrice: 10,
          },
        ],
      })
      .expect(200);

    const partLine = await prisma.workshopTaskLineItem.findFirstOrThrow({
      where: { workshop_task_id: taskId, type: 'PART' },
      select: { id: true },
    });
    const site = await prisma.site.findFirstOrThrow({
      where: { tenant_id: tenantId },
      select: { id: true },
    });
    const location = await prisma.storageLocation.create({
      data: {
        tenant_id: tenantId,
        site_id: site.id,
        code: `AUT972-BIN-${Date.now()}`,
        name: 'Parts bin',
        type: 'bin',
      },
      select: { id: true },
    });

    const res = await request(app.getHttpServer())
      .post('/api/parts-reservations')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        workshopTaskLineItemId: partLine.id,
        quantity: 1,
        locationId: location.id,
      })
      .expect(422);

    expect(JSON.stringify(res.body)).toContain('NOT_A_CATALOG_LINE');
    expect(
      await prisma.partsReservation.count({
        where: { workshop_task_line_item_id: partLine.id },
      }),
    ).toBe(0);
  });

  it('still blocks DONE and invoicing for catalog-backed PENDING_PICK lines', async () => {
    const { orderId, taskId } = await createOrderWithTask();
    const catalogItem = await prisma.catalogItem.create({
      data: {
        tenant_id: tenantId,
        sku: `AUT972-CAT-${Date.now()}`,
        name: 'Catalog pad',
        cost_price: 12,
        retail_price: 24,
      },
    });
    await prisma.workshopTaskLineItem.create({
      data: {
        tenant_id: tenantId,
        workshop_task_id: taskId,
        type: 'PART',
        part_execution_status: 'PENDING_PICK',
        item_no: catalogItem.sku,
        description: catalogItem.name,
        quantity: 1,
        unit_price: 24,
        catalog_item_id: catalogItem.id,
      },
    });

    await request(app.getHttpServer())
      .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'IN_PROGRESS' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'DONE' })
      .expect(409);

    await prisma.workshopTask.update({
      where: { id: taskId },
      data: { status: 'DONE' },
    });
    await prisma.workshopOrder.update({
      where: { id: orderId },
      data: { status: 'COMPLETED' },
    });

    await request(app.getHttpServer())
      .post('/api/invoices/drafts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ workshopOrderId: orderId })
      .expect(409);
  });

  it('returns 403 for TECH on task status PATCH and parts reservation POST', async () => {
    const isolatedTenant = await createTestTenant(basePrisma, 'aut972-tech');
    try {
      const firebaseUid = `aut972-tech-${Date.now()}`;
      const user = await basePrisma.user.create({
        data: {
          firebaseUid,
          email: `${firebaseUid}@example.com`,
        },
      });
      await seedTestTenantMember(basePrisma, {
        tenantId: isolatedTenant.tenantId,
        userId: user.id,
        role: 'TECH',
      });
      const siteId = await runWithTenantContext(
        isolatedTenant.tenantId,
        async () => {
          const site = await basePrisma.site.findFirstOrThrow({
            where: { tenant_id: isolatedTenant.tenantId },
            select: { id: true },
          });
          await basePrisma.siteMembership.create({
            data: {
              tenant_id: isolatedTenant.tenantId,
              user_id: user.id,
              site_id: site.id,
              is_active: true,
            },
          });
          await basePrisma.user.update({
            where: { id: user.id },
            data: { active_site_id: site.id },
          });
          return site.id;
        },
      );
      const techToken = app.get(AuthService).createTestToken({
        sub: firebaseUid,
        email: user.email,
        tenantId: isolatedTenant.tenantId,
        role: 'TECH',
      });
      const techPrisma = createTenantAwarePrisma(
        basePrisma,
        isolatedTenant.tenantId,
      );
      const customer = await techPrisma.customer.create({
        data: {
          tenant_id: isolatedTenant.tenantId,
          first_name: 'Tech',
          last_name: 'Case',
          email: `tech-${Date.now()}@example.com`,
        },
      });
      const vehicle = await techPrisma.vehicle.create({
        data: {
          tenant_id: isolatedTenant.tenantId,
          customer_id: customer.id,
          make: 'VW',
          model: 'Golf',
          year: 2018,
        },
      });
      const order = await techPrisma.workshopOrder.create({
        data: {
          tenant_id: isolatedTenant.tenantId,
          order_number: `AUT972-TECH-${Date.now()}`,
          site_id: siteId,
          customer_id: customer.id,
          vehicle_id: vehicle.id,
          status: 'IN_PROGRESS',
          odometer: 10000,
          fuel_level: 50,
        },
      });
      const task = await techPrisma.workshopTask.create({
        data: {
          tenant_id: isolatedTenant.tenantId,
          workshop_order_id: order.id,
          title: 'TECH blocked task',
          status: 'IN_PROGRESS',
        },
      });
      const line = await techPrisma.workshopTaskLineItem.create({
        data: {
          tenant_id: isolatedTenant.tenantId,
          workshop_task_id: task.id,
          type: 'PART',
          part_execution_status: null,
          item_no: 'FREE',
          description: 'Free text',
          quantity: 1,
          unit_price: 5,
        },
      });
      const location = await techPrisma.storageLocation.findFirstOrThrow({
        where: { tenant_id: isolatedTenant.tenantId, site_id: siteId },
        select: { id: true },
      });

      await request(app.getHttpServer())
        .patch(`/api/workshop/orders/${order.id}/tasks/${task.id}`)
        .set('Authorization', `Bearer ${techToken}`)
        .send({ status: 'DONE' })
        .expect(403);

      await request(app.getHttpServer())
        .post('/api/parts-reservations')
        .set('Authorization', `Bearer ${techToken}`)
        .send({
          workshopTaskLineItemId: line.id,
          quantity: 1,
          locationId: location.id,
        })
        .expect(403);
    } finally {
      await cleanupTestTenantGraph(basePrisma, isolatedTenant.tenantId).catch(
        () => undefined,
      );
    }
  });

  it('migration backfill clears legacy free-text PART lines stuck in PENDING_PICK', async () => {
    const dropPartStatusCheck = `ALTER TABLE workshop_task_line_items DROP CONSTRAINT IF EXISTS workshop_task_line_items_part_status_check`;
    const backfillFreeTextPartStatus = `
      UPDATE workshop_task_line_items
      SET part_execution_status = NULL
      WHERE type = 'PART'
        AND catalog_item_id IS NULL
        AND part_execution_status IS NOT NULL`;
    const addPartStatusCheck = `
      ALTER TABLE workshop_task_line_items
      ADD CONSTRAINT workshop_task_line_items_part_status_check
      CHECK (
        (type IN ('LABOR', 'FEE') AND part_execution_status IS NULL)
        OR (type = 'PART' AND catalog_item_id IS NOT NULL AND part_execution_status IS NOT NULL)
        OR (type = 'PART' AND catalog_item_id IS NULL AND part_execution_status IS NULL)
      )`;

    const { taskId } = await createOrderWithTask();
    const line = await prisma.workshopTaskLineItem.create({
      data: {
        tenant_id: tenantId,
        workshop_task_id: taskId,
        type: 'PART',
        item_no: 'LEGACY-PICK',
        description: 'Pre-migration row',
        quantity: 1,
        unit_price: 1,
        part_execution_status: null,
      },
    });

    await prisma.$executeRawUnsafe(dropPartStatusCheck);
    await prisma.workshopTaskLineItem.update({
      where: { id: line.id },
      data: { part_execution_status: 'PENDING_PICK' },
    });

    try {
      await prisma.$executeRawUnsafe(dropPartStatusCheck);
      await prisma.$executeRawUnsafe(backfillFreeTextPartStatus);
      await prisma.$executeRawUnsafe(addPartStatusCheck);

      const updated = await prisma.workshopTaskLineItem.findFirstOrThrow({
        where: { id: line.id, tenant_id: tenantId },
      });
      expect(updated.part_execution_status).toBeNull();
    } finally {
      await prisma.$executeRawUnsafe(dropPartStatusCheck);
      await prisma.$executeRawUnsafe(addPartStatusCheck);
    }
  });
});
