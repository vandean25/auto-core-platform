import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { signNotificationTaskPayload } from '../src/notifications/notification-task.payload.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PushDeviceCleanupService } from '../src/push/push-device-cleanup.service.js';
import {
  PushMessagingGateway,
  type PushSendOutcome,
  type PushSendTarget,
} from '../src/push/push-messaging.gateway.js';
import type { PushData } from '../src/push/push-message.js';
import { createE2eApp } from './helpers/e2e-suite.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
  seedTestTenantMember,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

const SECRET = 'push-e2e-worker-secret';

class FakePushGateway extends PushMessagingGateway {
  sent: Array<{ targets: PushSendTarget[]; message: PushData }> = [];

  sendEach(
    targets: PushSendTarget[],
    message: PushData,
  ): Promise<PushSendOutcome[]> {
    this.sent.push({ targets, message });
    return Promise.resolve(
      targets.map((target) => ({ deviceId: target.deviceId, ok: true })),
    );
  }
}

/** AUT-766 / ADR-0033: the `/me/push` API, tenant isolation, the kill switch and the cleanup job. */
describe('Web push for staff (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let authService: AuthService;
  const gateway = new FakePushGateway();
  const saved: Record<string, string | undefined> = {};

  let tenantA: TestTenantResult;
  let tenantB: TestTenantResult;
  let userA2: TestTenantResult;
  let userA2Id: string;
  let headerA1: string;
  let headerA2: string;
  let headerB: string;

  const api = () => request(app.getHttpServer());
  const tenantPrisma = (tenantId: string) =>
    createTenantAwarePrisma(basePrisma, tenantId);
  const register = (header: string, token: string) =>
    api().post('/api/v1/me/push/devices').set('Authorization', header).send({
      token,
      platform: 'DESKTOP',
      browser: 'chrome',
      installed: false,
    });
  const deliver = (outboxId: string, tenantId: string) =>
    api()
      .post(`/api/notifications/outbox/${outboxId}/worker`)
      .set('x-cloud-tasks-secret', SECRET)
      .set('x-tenant-id', tenantId)
      .send(signNotificationTaskPayload({ outboxId, tenantId }, SECRET));

  beforeAll(async () => {
    app = await createE2eApp((builder) =>
      builder.overrideProvider(PushMessagingGateway).useValue(gateway),
    );
    basePrisma = app.get(PrismaService);
    authService = app.get(AuthService);
    for (const key of [
      'CLOUD_TASKS_WORKER_SECRET',
      'NOTIFICATION_EMAIL_MODE',
      'PUSH_ENABLED',
    ]) {
      saved[key] = process.env[key];
    }
    process.env.CLOUD_TASKS_WORKER_SECRET = SECRET;
    // The worker route serves only a sender instance (NOTIFICATION_EMAIL_MODE set).
    process.env.NOTIFICATION_EMAIL_MODE = 'fake';

    tenantA = await createTestTenant(basePrisma, 'push-a');
    tenantB = await createTestTenant(basePrisma, 'push-b');
    const second = await basePrisma.user.create({
      data: {
        firebaseUid: `e2e-user2-${tenantA.tenantId}`,
        email: `e2e-user2-${tenantA.tenantId}@example.com`,
      },
      select: { id: true },
    });
    userA2Id = second.id;
    await seedTestTenantMember(basePrisma, {
      tenantId: tenantA.tenantId,
      userId: userA2Id,
      role: 'ADMIN',
    });
    userA2 = {
      tenantId: tenantA.tenantId,
      firebaseUid: `e2e-user2-${tenantA.tenantId}`,
      email: `e2e-user2-${tenantA.tenantId}@example.com`,
      role: 'ADMIN',
    };
    headerA1 = `Bearer ${createTestAuthToken(authService, tenantA)}`;
    headerA2 = `Bearer ${createTestAuthToken(authService, userA2)}`;
    headerB = `Bearer ${createTestAuthToken(authService, tenantB)}`;
  });

  beforeEach(() => {
    gateway.sent = [];
    delete process.env.PUSH_ENABLED;
  });

  afterAll(async () => {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    for (const tenant of [tenantA, tenantB]) {
      if (tenant) {
        const db = tenantPrisma(tenant.tenantId);
        await db.notificationOutbox.deleteMany({});
        await db.pushDevice.deleteMany({});
        await db.pushPreference.deleteMany({});
        await cleanupTestTenantGraph(basePrisma, tenant.tenantId);
      }
    }
    await teardownTestApp(app, basePrisma);
  });

  it('registers a device, lists it without the token, and keeps it private to its owner', async () => {
    const token = `token-${randomUUID()}`;
    const created = await register(headerA1, token).expect(201);
    expect(created.body).toMatchObject({
      platform: 'DESKTOP',
      browser: 'chrome',
    });
    expect(JSON.stringify(created.body)).not.toContain(token);

    const own = await api()
      .get('/api/v1/me/push/devices')
      .set('Authorization', headerA1)
      .expect(200);
    expect(own.body).toHaveLength(1);
    expect(JSON.stringify(own.body)).not.toContain(token);

    for (const header of [headerA2, headerB]) {
      const other = await api()
        .get('/api/v1/me/push/devices')
        .set('Authorization', header)
        .expect(200);
      expect(other.body).toEqual([]);
      await api()
        .delete(`/api/v1/me/push/devices/${created.body.id}`)
        .set('Authorization', header)
        .expect(404);
    }
    const row = await tenantPrisma(tenantA.tenantId).pushDevice.findFirst({
      where: { id: created.body.id, tenant_id: tenantA.tenantId },
    });
    expect(row?.revoked_at).toBeNull();
  });

  it('keeps the same token in two tenants apart', async () => {
    const token = `shared-${randomUUID()}`;
    const a = await register(headerA1, token).expect(201);
    const b = await register(headerB, token).expect(201);
    expect(a.body.id).not.toBe(b.body.id);

    await api()
      .delete(`/api/v1/me/push/devices/${b.body.id}`)
      .set('Authorization', headerB)
      .expect(204);
    const stillA = await tenantPrisma(tenantA.tenantId).pushDevice.findFirst({
      where: { id: a.body.id, tenant_id: tenantA.tenantId },
    });
    expect(stillA?.revoked_at).toBeNull();
  });

  it('stores preferences per user and refuses unknown events and half a quiet window', async () => {
    await api()
      .put('/api/v1/me/push/preferences')
      .set('Authorization', headerA1)
      .send({
        enabledEvents: ['CUSTOMER_ESTIMATE_DECIDED'],
        quietStartMin: 1320,
        quietEndMin: 360,
      })
      .expect(200);

    const own = await api()
      .get('/api/v1/me/push/preferences')
      .set('Authorization', headerA1)
      .expect(200);
    expect(own.body).toEqual({
      enabledEvents: ['CUSTOMER_ESTIMATE_DECIDED'],
      quietStartMin: 1320,
      quietEndMin: 360,
    });
    const other = await api()
      .get('/api/v1/me/push/preferences')
      .set('Authorization', headerA2)
      .expect(200);
    expect(other.body).toEqual({
      enabledEvents: [],
      quietStartMin: null,
      quietEndMin: null,
    });

    await api()
      .put('/api/v1/me/push/preferences')
      .set('Authorization', headerA1)
      .send({
        enabledEvents: ['PUSH_TEST'],
        quietStartMin: null,
        quietEndMin: null,
      })
      .expect(400);
    await api()
      .put('/api/v1/me/push/preferences')
      .set('Authorization', headerA1)
      .send({ enabledEvents: [], quietStartMin: 60, quietEndMin: null })
      .expect(400);
  });

  it('queues a test push that stays suppressed while the kill switch is off and sends only to the caller when on', async () => {
    const db = tenantPrisma(tenantA.tenantId);
    await db.pushDevice.deleteMany({});
    const own = await register(headerA1, `own-${randomUUID()}`).expect(201);
    await register(headerA2, `colleague-${randomUUID()}`).expect(201);
    await register(headerB, `other-tenant-${randomUUID()}`).expect(201);
    const ownToken = (
      await db.pushDevice.findFirst({
        where: { id: own.body.id, tenant_id: tenantA.tenantId },
      })
    )?.fcm_token;

    const first = await api()
      .post('/api/v1/me/push/test')
      .set('Authorization', headerA1)
      .expect(202);
    const queued = await db.notificationOutbox.findFirst({
      where: { id: first.body.id, tenant_id: tenantA.tenantId },
    });
    expect(queued).toMatchObject({
      channel: 'PUSH',
      event_type: 'PUSH_TEST',
      status: 'PENDING',
      body: null,
    });
    expect(queued?.recipient_user_id).not.toBeNull();

    await deliver(first.body.id, tenantA.tenantId).expect(204);
    const suppressed = await db.notificationOutbox.findFirst({
      where: { id: first.body.id, tenant_id: tenantA.tenantId },
    });
    expect(suppressed).toMatchObject({
      status: 'SUPPRESSED',
      suppressed_reason: 'PUSH_DISABLED',
    });
    expect(gateway.sent).toHaveLength(0);

    process.env.PUSH_ENABLED = 'true';
    const second = await api()
      .post('/api/v1/me/push/test')
      .set('Authorization', headerA1)
      .expect(202);
    await deliver(second.body.id, tenantA.tenantId).expect(204);
    const accepted = await db.notificationOutbox.findFirst({
      where: { id: second.body.id, tenant_id: tenantA.tenantId },
    });
    expect(accepted).toMatchObject({ status: 'ACCEPTED', provider: 'fcm' });
    expect(gateway.sent).toHaveLength(1);
    expect(gateway.sent[0].targets.map((target) => target.token)).toEqual([
      ownToken,
    ]);
    expect(Object.keys(gateway.sent[0].message).sort()).toEqual(
      ['body', 'eventType', 'tag', 'title'].sort(),
    );
  });

  it('answers 429 after five test pushes in an hour and 409 without a device', async () => {
    await api()
      .post('/api/v1/me/push/test')
      .set('Authorization', headerA2)
      .expect(202);
    for (let i = 0; i < 4; i += 1) {
      await api()
        .post('/api/v1/me/push/test')
        .set('Authorization', headerA2)
        .expect(202);
    }
    await api()
      .post('/api/v1/me/push/test')
      .set('Authorization', headerA2)
      .expect(429);

    const fresh = await createTestTenant(basePrisma, 'push-nodevice');
    try {
      await api()
        .post('/api/v1/me/push/test')
        .set(
          'Authorization',
          `Bearer ${createTestAuthToken(authService, fresh)}`,
        )
        .expect(409);
    } finally {
      await cleanupTestTenantGraph(basePrisma, fresh.tenantId);
    }
  });

  it('the cleanup job revokes idle devices and those of departed members', async () => {
    const db = tenantPrisma(tenantA.tenantId);
    await db.pushDevice.deleteMany({});
    const idle = await register(headerA1, `idle-${randomUUID()}`).expect(201);
    const departed = await register(
      headerA2,
      `departed-${randomUUID()}`,
    ).expect(201);
    await db.pushDevice.updateMany({
      where: { id: idle.body.id, tenant_id: tenantA.tenantId },
      data: { last_seen_at: new Date(Date.now() - 61 * 24 * 60 * 60 * 1000) },
    });
    await runWithTenantContext(tenantA.tenantId, () =>
      basePrisma.tenantMember.updateMany({
        where: { tenant_id: tenantA.tenantId, user_id: userA2Id },
        data: { is_active: false },
      }),
    );

    await app.get(PushDeviceCleanupService).run();

    const rows = await db.pushDevice.findMany({
      where: { tenant_id: tenantA.tenantId },
    });
    expect(rows.find((row) => row.id === idle.body.id)).toMatchObject({
      revoked_reason: 'STALE',
    });
    expect(rows.find((row) => row.id === departed.body.id)).toMatchObject({
      revoked_reason: 'MEMBERSHIP_ENDED',
    });
  });
});
