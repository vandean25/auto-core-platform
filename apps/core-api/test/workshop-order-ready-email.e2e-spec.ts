import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { seedReadySellerAndAccountingProfile } from './invoice-snapshot-v2-test-utils.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('Workshop order ready email (AUT-357 e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let testTenant: TestTenantResult;
  let adminToken: string;
  let adminUserId: string;
  let customerId: string;
  let otherTenantId: string | undefined;

  const api = () => request(app.getHttpServer());
  const adminAuth = () => ({ Authorization: `Bearer ${adminToken}` });

  async function setTenantMemberRole(role: 'ADMIN' | 'TECH') {
    await prisma.tenantMember.updateMany({
      where: { tenant_id: tenantId },
      data: { role },
    });
  }

  async function completeCustomerOrder(forCustomerId: string) {
    const vehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'Skoda',
        model: 'Octavia',
        year: 2019,
        vin: `VIN-RDY-${randomUUID()}`,
        customer_id: forCustomerId,
      },
    });
    const order = await api()
      .post('/api/workshop/orders')
      .set(adminAuth())
      .send({
        customerId: forCustomerId,
        vehicleId: vehicle.id,
        odometer: 1000,
        fuelLevel: 50,
      })
      .expect(201);
    const orderId = order.body.id as string;
    const task = await api()
      .post(`/api/workshop/orders/${orderId}/tasks`)
      .set(adminAuth())
      .send({ title: 'Service' })
      .expect(201);
    await api()
      .patch(`/api/workshop/orders/${orderId}/tasks/${task.body.id}`)
      .set(adminAuth())
      .send({ status: 'DONE' })
      .expect(200);
    return orderId;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();
    basePrisma = app.get(PrismaService);
    const authService = app.get(AuthService);
    testTenant = await createTestTenant(basePrisma);
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    adminToken = createTestAuthToken(authService, testTenant);
    await seedReadySellerAndAccountingProfile(prisma, tenantId);
    const adminUser = await prisma.user.findFirstOrThrow({
      where: { firebaseUid: testTenant.firebaseUid },
      select: { id: true },
    });
    adminUserId = adminUser.id;
    const customer = await prisma.customer.create({
      data: {
        tenant_id: tenantId,
        first_name: 'Max',
        last_name: 'Muster',
        email: 'ready@example.at',
        type: 'PRIVATE',
        contact_email_ok: true,
      },
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.notificationOutbox.deleteMany();
    await prisma.workshopTask.deleteMany();
    await prisma.workshopOrder.deleteMany();
    await prisma.vehicle.deleteMany();
    await prisma.customer.deleteMany();
    if (otherTenantId) {
      await cleanupTestTenantGraph(basePrisma, otherTenantId);
    }
    await cleanupTestTenantGraph(basePrisma, tenantId);
    await teardownTestApp(app, basePrisma);
  });

  it('queues one ready email on first transition to COMPLETED and exposes notice on the order', async () => {
    const orderId = await completeCustomerOrder(customerId);
    const detail = await api()
      .get(`/api/workshop/orders/${orderId}`)
      .set(adminAuth())
      .expect(200);
    expect(detail.body.status).toBe('COMPLETED');
    expect(detail.body.ready_email_notice?.code).toBe('QUEUED');

    const outboxCount = await prisma.notificationOutbox.count({
      where: {
        workshop_order_id: orderId,
        event_type: 'WORKSHOP_ORDER_READY',
      },
    });
    expect(outboxCount).toBe(1);

    const communications = await api()
      .get(`/api/workshop/orders/${orderId}/communications`)
      .set(adminAuth())
      .expect(200);
    const readyRows = communications.body.data.filter(
      (row: { kind: string }) => row.kind === 'READY_EMAIL',
    );
    expect(readyRows).toHaveLength(1);

    await api()
      .patch(`/api/workshop/orders/${orderId}/tasks/${detail.body.tasks[0].id}`)
      .set(adminAuth())
      .send({ status: 'DONE' })
      .expect(200);
    const communicationsAgain = await api()
      .get(`/api/workshop/orders/${orderId}/communications`)
      .set(adminAuth())
      .expect(200);
    const readyAgain = communicationsAgain.body.data.filter(
      (row: { kind: string }) => row.kind === 'READY_EMAIL',
    );
    expect(readyAgain).toHaveLength(1);
    expect(
      await prisma.notificationOutbox.count({
        where: {
          workshop_order_id: orderId,
          event_type: 'WORKSHOP_ORDER_READY',
        },
      }),
    ).toBe(1);
  });

  it('shows a blocked notice and writes no outbox row when contact_email_ok is false', async () => {
    const blocked = await prisma.customer.create({
      data: {
        tenant_id: tenantId,
        first_name: 'Erika',
        last_name: 'Beispiel',
        email: 'blocked@example.at',
        type: 'PRIVATE',
        contact_email_ok: false,
      },
    });
    const orderId = await completeCustomerOrder(blocked.id);
    const detail = await api()
      .get(`/api/workshop/orders/${orderId}`)
      .set(adminAuth())
      .expect(200);
    expect(detail.body.ready_email_notice?.code).toBe(
      'BLOCKED_EMAIL_NOT_CONFIRMED',
    );
    expect(
      await prisma.notificationOutbox.count({
        where: {
          workshop_order_id: orderId,
          event_type: 'WORKSHOP_ORDER_READY',
        },
      }),
    ).toBe(0);
  });

  it('allows advisor resend with audit and a second outbox occurrence', async () => {
    const orderId = await completeCustomerOrder(customerId);
    const resend = await api()
      .post(`/api/workshop/orders/${orderId}/ready-email/resend`)
      .set(adminAuth())
      .expect(200);
    expect(resend.body.code).toBe('QUEUED');

    expect(
      await prisma.notificationOutbox.count({
        where: {
          workshop_order_id: orderId,
          event_type: 'WORKSHOP_ORDER_READY',
        },
      }),
    ).toBe(2);

    const audit = await prisma.auditLog.findFirst({
      where: {
        tenant_id: tenantId,
        source: 'workshop-order-ready-resend',
        actor_user_id: adminUserId,
      },
      orderBy: { occurred_at: 'desc' },
    });
    expect(audit).toMatchObject({
      action: 'CREATE',
      entity_type: 'NotificationOutbox',
    });
    expect(audit?.after).toMatchObject({
      workshop_order_id: orderId,
      event_type: 'WORKSHOP_ORDER_READY',
      resend: true,
    });

    const communications = await api()
      .get(`/api/workshop/orders/${orderId}/communications`)
      .set(adminAuth())
      .expect(200);
    const readyRows = communications.body.data.filter(
      (row: { kind: string }) => row.kind === 'READY_EMAIL',
    );
    expect(readyRows).toHaveLength(2);
  });

  it('refuses resend for TECH with 403', async () => {
    const orderId = await completeCustomerOrder(customerId);
    await setTenantMemberRole('TECH');
    try {
      await api()
        .post(`/api/workshop/orders/${orderId}/ready-email/resend`)
        .set(adminAuth())
        .expect(403);
    } finally {
      await setTenantMemberRole('ADMIN');
    }
  });

  it('isolates ready communications by tenant', async () => {
    const orderId = await completeCustomerOrder(customerId);
    const other = await createTestTenant(basePrisma);
    otherTenantId = other.tenantId;
    const otherToken = createTestAuthToken(app.get(AuthService), other);
    await api()
      .get(`/api/workshop/orders/${orderId}/communications`)
      .set({ Authorization: `Bearer ${otherToken}` })
      .expect(404);
  });
});
