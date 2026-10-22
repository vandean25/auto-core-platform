import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { AuthService } from '../src/auth/auth.service.js';
import { NotificationOutboxService } from '../src/notifications/notification-outbox.service.js';
import { MechanicMediaStorage } from '../src/mechanic/mechanic-media.storage.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestTenant,
  runWithTenantContext,
  seedTestTenantMember,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

/**
 * AUT-356 phase 1: WAITING_CUSTOMER writes an advisor outbox row in the same transaction as the
 * task transition. A rolled-back transition leaves no row behind, and a repeated write is a no-op.
 */
describe('Notification outbox: WAITING_CUSTOMER (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let tenantId: string;
  let otherTenantId: string;
  let authToken: string;
  let mechanicId: string;
  let mechanicUserId: string;
  let orderId: string;
  let taskAId: string;
  let taskBId: string;
  let taskCId: string;

  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${authToken}` });

  const mockMediaStorage = {
    createPresignedUpload: jest.fn(),
    ensureBucketExists: jest.fn(),
  };

  beforeAll(async () => {
    process.env.WORKSHOP_MEDIA_BUCKET = 'test-workshop-media-bucket';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MechanicMediaStorage)
      .useValue(mockMediaStorage)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    basePrisma = app.get<PrismaService>(PrismaService);
    const authService = app.get<AuthService>(AuthService);

    const tenant = await createTestTenant(basePrisma, 'notif-outbox');
    tenantId = tenant.tenantId;
    const other = await createTestTenant(basePrisma, 'notif-outbox-other');
    otherTenantId = other.tenantId;

    await runWithTenantContext(tenantId, async () => {
      const firebaseUid = `e2e-notif-${Date.now()}`;
      const user = await basePrisma.user.create({
        data: { firebaseUid, email: `e2e-notif-${Date.now()}@workshop.local` },
      });
      mechanicUserId = user.id;
      await seedTestTenantMember(basePrisma, {
        tenantId,
        userId: user.id,
        role: 'TECH',
      });
      authToken = authService.createTestToken({
        sub: firebaseUid,
        email: user.email,
        tenantId,
        role: 'TECH',
      });

      const mechanic = await basePrisma.employee.create({
        data: {
          tenant_id: tenantId,
          name: 'E2E Notification Mechanic',
          role: 'MECHANIC',
          is_active: true,
          user_id: user.id,
        },
      });
      mechanicId = mechanic.id;

      const customer = await basePrisma.customer.create({
        data: {
          tenant_id: tenantId,
          first_name: 'E2E',
          last_name: 'NotifCustomer',
          email: `e2e-notif-${randomUUID()}@example.com`,
          type: 'PRIVATE',
        },
      });
      const vehicle = await basePrisma.vehicle.create({
        data: {
          tenant_id: tenantId,
          make: 'Audi',
          model: 'A4',
          year: 2021,
          vin: `VIN-NOTIF-${randomUUID()}`,
          customer_id: customer.id,
        },
      });
      const order = await basePrisma.workshopOrder.create({
        data: {
          tenant_id: tenantId,
          order_number: `WO-NOTIF-${Date.now()}`,
          customer_id: customer.id,
          vehicle_id: vehicle.id,
          mechanic_id: mechanicId,
          odometer: 90000,
          fuel_level: 50,
          status: 'INTAKE',
        },
      });
      orderId = order.id;

      const tasks = await Promise.all(
        ['Oil change', 'Brake inspection', 'Fluid top-up'].map((title, index) =>
          basePrisma.workshopTask.create({
            data: {
              tenant_id: tenantId,
              workshop_order_id: orderId,
              title,
              sequence: index + 1,
              status: 'NOT_STARTED',
            },
          }),
        ),
      );
      [taskAId, taskBId, taskCId] = tasks.map((task) => task.id);
    });
  });

  afterAll(async () => {
    // Outbox rows reference their order with ON DELETE RESTRICT, so they go before the graph cleanup.
    for (const id of [tenantId, otherTenantId]) {
      if (id) {
        await createTenantAwarePrisma(
          basePrisma,
          id,
        ).notificationOutbox.deleteMany({});
      }
    }
    if (otherTenantId) await cleanupTestTenantGraph(basePrisma, otherTenantId);
    if (tenantId) await cleanupTestTenantGraph(basePrisma, tenantId);
    if (mechanicUserId) {
      await basePrisma.user.deleteMany({ where: { id: mechanicUserId } });
    }
    await teardownTestApp(app, basePrisma);
  });

  const tenantPrisma = () => createTenantAwarePrisma(basePrisma, tenantId);

  const outboxForOrder = () =>
    tenantPrisma().notificationOutbox.findMany({
      where: { workshop_order_id: orderId },
      orderBy: { createdAt: 'asc' },
    });

  it('pause to WAITING_CUSTOMER writes one accepted internal row keyed by the closed labor entry', async () => {
    await api()
      .post(`/api/mechanic/tasks/${taskAId}/start`)
      .set(auth())
      .expect(200);
    await api()
      .post(`/api/mechanic/tasks/${taskAId}/pause`)
      .set(auth())
      .send({ pauseReason: 'WAITING_CUSTOMER' })
      .expect(200);

    const closedEntry = await tenantPrisma().laborEntry.findFirst({
      where: { tenant_id: tenantId, workshop_task_id: taskAId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, ended_at: true },
    });
    expect(closedEntry?.ended_at).not.toBeNull();

    const rows = await outboxForOrder();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: tenantId,
      event_type: 'WORKSHOP_TASK_WAITING_CUSTOMER',
      channel: 'IN_APP',
      recipient_kind: 'INTERNAL_TEAM',
      recipient_email: null,
      message_class: 'TRANSACTIONAL',
      status: 'ACCEPTED',
      source_entity_type: 'WorkshopTask',
      source_entity_id: taskAId,
      idempotency_key: `WORKSHOP_TASK_WAITING_CUSTOMER:${closedEntry?.id}:advisors:IN_APP`,
    });
    expect(rows[0].payload).toMatchObject({
      taskId: taskAId,
      workshopOrderId: orderId,
      mechanicEmployeeId: mechanicId,
    });
  });

  it('a pause with another reason writes no outbox row', async () => {
    await api()
      .post(`/api/mechanic/tasks/${taskCId}/start`)
      .set(auth())
      .expect(200);
    await api()
      .post(`/api/mechanic/tasks/${taskCId}/pause`)
      .set(auth())
      .send({ pauseReason: 'OTHER' })
      .expect(200);

    const rows = await outboxForOrder();
    expect(rows.filter((row) => row.source_entity_id === taskCId)).toHaveLength(
      0,
    );
  });

  it('rolls the task transition back when the outbox write fails inside the transaction', async () => {
    await api()
      .post(`/api/mechanic/tasks/${taskBId}/start`)
      .set(auth())
      .expect(200);
    const outbox = app.get(NotificationOutboxService);
    const realEnqueue = outbox.enqueueInTx.bind(outbox);
    const spy = jest
      .spyOn(outbox, 'enqueueInTx')
      .mockImplementationOnce(async (tx, input, now) => {
        await realEnqueue(tx, input, now);
        throw new Error('simulated failure after the outbox write');
      });

    try {
      await api()
        .post(`/api/mechanic/tasks/${taskBId}/pause`)
        .set(auth())
        .send({ pauseReason: 'WAITING_CUSTOMER' })
        .expect(500);
    } finally {
      spy.mockRestore();
    }

    const openEntry = await tenantPrisma().laborEntry.findFirst({
      where: { tenant_id: tenantId, workshop_task_id: taskBId, ended_at: null },
      select: { id: true },
    });
    expect(openEntry).not.toBeNull();
    const task = await tenantPrisma().workshopTask.findFirst({
      where: { id: taskBId, tenant_id: tenantId },
      select: { status: true },
    });
    expect(task?.status).toBe('IN_PROGRESS');

    const rows = await outboxForOrder();
    expect(rows.filter((row) => row.source_entity_id === taskBId)).toHaveLength(
      0,
    );
  });

  it('switch with previous reason WAITING_CUSTOMER writes the row in the switch transaction', async () => {
    await api()
      .post(`/api/mechanic/tasks/${taskAId}/switch`)
      .set(auth())
      .send({ previousPauseReason: 'WAITING_CUSTOMER' })
      .expect(200);

    const rows = await outboxForOrder();
    const forB = rows.filter((row) => row.source_entity_id === taskBId);
    expect(forB).toHaveLength(1);
    expect(forB[0].status).toBe('ACCEPTED');
  });

  it('rolls the switch back when the outbox write fails inside the switch transaction', async () => {
    // The mechanic holds the open labor entry on task A from the switch above. Switch from A to C.
    const outbox = app.get(NotificationOutboxService);
    const realEnqueue = outbox.enqueueInTx.bind(outbox);
    const openBefore = await tenantPrisma().laborEntry.findFirst({
      where: { tenant_id: tenantId, workshop_task_id: taskAId, ended_at: null },
      select: { id: true },
    });
    expect(openBefore).not.toBeNull();
    const rowsBefore = await outboxForOrder();

    const spy = jest
      .spyOn(outbox, 'enqueueInTx')
      .mockImplementationOnce(async (tx, input, now) => {
        await realEnqueue(tx, input, now);
        throw new Error('simulated failure after the outbox write');
      });
    try {
      await api()
        .post(`/api/mechanic/tasks/${taskCId}/switch`)
        .set(auth())
        .send({ previousPauseReason: 'WAITING_CUSTOMER' })
        .expect(500);
    } finally {
      spy.mockRestore();
    }

    const stillOpen = await tenantPrisma().laborEntry.findFirst({
      where: { tenant_id: tenantId, workshop_task_id: taskAId, ended_at: null },
      select: { id: true },
    });
    expect(stillOpen?.id).toBe(openBefore?.id);
    const taskA = await tenantPrisma().workshopTask.findFirst({
      where: { id: taskAId, tenant_id: tenantId },
      select: { status: true },
    });
    expect(taskA?.status).toBe('IN_PROGRESS');
    expect(await outboxForOrder()).toHaveLength(rowsBefore.length);
  });

  it('a repeated write for the same occurrence is a no-op at the database', async () => {
    const outbox = app.get(NotificationOutboxService);
    const input = {
      tenantId,
      eventType: 'WORKSHOP_TASK_WAITING_CUSTOMER' as const,
      occurrenceId: randomUUID(),
      channel: 'IN_APP' as const,
      recipientKind: 'INTERNAL_TEAM' as const,
      recipientKey: 'advisors',
      workshopOrderId: orderId,
      sourceEntityType: 'WorkshopTask',
      sourceEntityId: taskCId,
    };

    const first = await runWithTenantContext(tenantId, () =>
      basePrisma.$transaction((tx) => outbox.enqueueInTx(tx, input)),
    );
    const second = await runWithTenantContext(tenantId, () =>
      basePrisma.$transaction((tx) => outbox.enqueueInTx(tx, input)),
    );

    expect(first.blocked).toBe(false);
    if (!first.blocked) {
      expect(first.created).toBe(true);
      expect(second).toEqual({
        blocked: false,
        id: first.id,
        created: false,
      });
    }
    const stored = await createTenantAwarePrisma(
      basePrisma,
      tenantId,
    ).notificationOutbox.count({
      where: { idempotency_key: { contains: input.occurrenceId } },
    });
    expect(stored).toBe(1);
  });

  it('another tenant cannot see the order outbox rows', async () => {
    const seen = await createTenantAwarePrisma(
      basePrisma,
      otherTenantId,
    ).notificationOutbox.findMany({
      where: { workshop_order_id: orderId },
    });
    expect(seen).toHaveLength(0);
  });

  it("refuses a write in another tenant that names this tenant's order", async () => {
    const outbox = app.get(NotificationOutboxService);
    await expect(
      runWithTenantContext(otherTenantId, () =>
        basePrisma.$transaction((tx) =>
          outbox.enqueueInTx(tx, {
            tenantId: otherTenantId,
            eventType: 'WORKSHOP_TASK_WAITING_CUSTOMER',
            occurrenceId: randomUUID(),
            channel: 'IN_APP',
            recipientKind: 'INTERNAL_TEAM',
            recipientKey: 'advisors',
            workshopOrderId: orderId,
            sourceEntityType: 'WorkshopTask',
            sourceEntityId: taskAId,
          }),
        ),
      ),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('lets two tenants write the same idempotency key without colliding', async () => {
    const outbox = app.get(NotificationOutboxService);
    const shared = {
      eventType: 'WORKSHOP_TASK_WAITING_CUSTOMER' as const,
      occurrenceId: randomUUID(),
      channel: 'IN_APP' as const,
      recipientKind: 'INTERNAL_TEAM' as const,
      recipientKey: 'advisors',
    };

    const inThisTenant = await runWithTenantContext(tenantId, () =>
      basePrisma.$transaction((tx) =>
        outbox.enqueueInTx(tx, { ...shared, tenantId }),
      ),
    );
    const inOtherTenant = await runWithTenantContext(otherTenantId, () =>
      basePrisma.$transaction((tx) =>
        outbox.enqueueInTx(tx, { ...shared, tenantId: otherTenantId }),
      ),
    );

    expect(inThisTenant.blocked).toBe(false);
    expect(inOtherTenant.blocked).toBe(false);
    if (!inThisTenant.blocked && !inOtherTenant.blocked) {
      expect(inThisTenant.created).toBe(true);
      expect(inOtherTenant.created).toBe(true);
      expect(inOtherTenant.id).not.toBe(inThisTenant.id);
    }
  });
});
