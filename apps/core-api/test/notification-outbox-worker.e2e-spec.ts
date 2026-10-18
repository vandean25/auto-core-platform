import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { EmailProviderError } from '../src/notifications/email/email-provider.js';
import { FakeEmailProvider } from '../src/notifications/email/fake-email-provider.js';
import { NotificationCloudTasksService } from '../src/notifications/notification-cloud-tasks.service.js';
import { NotificationOutboxRecoveryService } from '../src/notifications/notification-outbox-recovery.service.js';
import { NotificationOutboxRetentionService } from '../src/notifications/notification-outbox-retention.service.js';
import { NotificationOutboxService } from '../src/notifications/notification-outbox.service.js';
import { signNotificationTaskPayload } from '../src/notifications/notification-task.payload.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestTenant,
  runWithTenantContext,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

const SECRET = 'notification-e2e-worker-secret';
const FROM = 'kontakt@example.at';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * AUT-356 phase 2: the sender worker. Rows are written in a transaction and sent only by the signed
 * Cloud Tasks route, never by the writer. The fake provider records what would have left the system.
 */
describe('Notification outbox sender worker (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let fake: FakeEmailProvider;
  let tenantA: string;
  let tenantB: string;
  const customerIds = new Map<string, string>();
  const saved: Record<string, string | undefined> = {};

  const api = () => request(app.getHttpServer());
  const tenantPrisma = (tenantId: string) =>
    createTenantAwarePrisma(basePrisma, tenantId);

  function setEnv(values: Record<string, string | undefined>) {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  async function ensureConsentTestCustomer(tenantId: string): Promise<string> {
    const existing = customerIds.get(tenantId);
    if (existing) {
      return existing;
    }
    const created = await tenantPrisma(tenantId).customer.create({
      data: {
        tenant_id: tenantId,
        type: 'PRIVATE',
        first_name: 'Test',
        last_name: 'Kunde',
        email: `consent-test-${tenantId}@example.at`,
        contact_email_ok: true,
      },
      select: { id: true },
    });
    customerIds.set(tenantId, created.id);
    return created.id;
  }

  async function emailInput(tenantId: string, recipient = 'kunde@example.at') {
    const customerId = await ensureConsentTestCustomer(tenantId);
    return {
      tenantId,
      eventType: 'WORKSHOP_TASK_WAITING_CUSTOMER' as const,
      occurrenceId: randomUUID(),
      channel: 'EMAIL' as const,
      recipientKind: 'CUSTOMER' as const,
      recipientKey: `customer:${customerId}`,
      consentPurpose: 'ORDER_COMMUNICATION' as const,
      email: {
        recipientEmail: recipient,
        subject: 'Auftrag Nr. E2E-1',
        text: 'Guten Tag,',
        senderName: 'Werkstatt E2E',
        replyToEmail: 'werkstatt@example.at',
      },
    };
  }

  /** Writes one EMAIL row in the caller's transaction, as a domain mutation would. */
  async function enqueue(
    tenantId: string,
    options: { now?: Date; recipient?: string } = {},
  ) {
    const outbox = app.get(NotificationOutboxService);
    const input = await emailInput(tenantId, options.recipient);
    const result = await runWithTenantContext(tenantId, () =>
      basePrisma.$transaction((tx) =>
        outbox.enqueueInTx(tx, input, options.now),
      ),
    );
    if (result.blocked) {
      throw new Error(`Outbox enqueue blocked: ${result.reason}`);
    }
    return result.id;
  }

  const readRow = (tenantId: string, id: string) =>
    tenantPrisma(tenantId).notificationOutbox.findFirst({
      where: { id, tenant_id: tenantId },
    });

  /** What Cloud Tasks sends: the signed payload, the shared secret and the tenant header. */
  const deliver = (outboxId: string, tenantId: string, secret = SECRET) =>
    api()
      .post(`/api/notifications/outbox/${outboxId}/worker`)
      .set('x-cloud-tasks-secret', SECRET)
      .set('x-tenant-id', tenantId)
      .send(signNotificationTaskPayload({ outboxId, tenantId }, secret));

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    basePrisma = app.get<PrismaService>(PrismaService);
    fake = app.get(FakeEmailProvider);
    tenantA = (await createTestTenant(basePrisma, 'notif-worker')).tenantId;
    tenantB = (await createTestTenant(basePrisma, 'notif-worker-other'))
      .tenantId;

    for (const key of [
      'CLOUD_TASKS_WORKER_SECRET',
      'NOTIFICATION_EMAIL_MODE',
      'NOTIFICATION_EMAIL_PROVIDER',
      'NOTIFICATION_EMAIL_RECIPIENT_ALLOWLIST',
      'NOTIFICATION_EMAIL_FROM_ADDRESS',
    ]) {
      saved[key] = process.env[key];
    }
    setEnv({
      CLOUD_TASKS_WORKER_SECRET: SECRET,
      NOTIFICATION_EMAIL_MODE: 'fake',
      NOTIFICATION_EMAIL_PROVIDER: 'brevo',
      NOTIFICATION_EMAIL_RECIPIENT_ALLOWLIST: '',
      NOTIFICATION_EMAIL_FROM_ADDRESS: FROM,
    });
  });

  beforeEach(() => {
    fake.reset();
    setEnv({
      NOTIFICATION_EMAIL_MODE: 'fake',
      NOTIFICATION_EMAIL_RECIPIENT_ALLOWLIST: '',
    });
  });

  afterAll(async () => {
    setEnv(saved);
    for (const tenantId of [tenantA, tenantB]) {
      if (tenantId) {
        await tenantPrisma(tenantId).notificationOutbox.deleteMany({});
        await cleanupTestTenantGraph(basePrisma, tenantId);
      }
    }
    await teardownTestApp(app, basePrisma);
  });

  it('writing a row never calls the provider; the row waits for the worker', async () => {
    const id = await enqueue(tenantA);

    expect(fake.sent).toHaveLength(0);
    const row = await readRow(tenantA, id);
    expect(row).toMatchObject({
      status: 'PENDING',
      provider: null,
      attempts: 0,
    });
  });

  it('the worker sends a due row through the fake provider and records ACCEPTED', async () => {
    const id = await enqueue(tenantA);

    await deliver(id, tenantA).expect(204);

    const row = await readRow(tenantA, id);
    expect(row).toMatchObject({
      status: 'ACCEPTED',
      provider: 'fake',
      attempts: 1,
      last_error_code: null,
    });
    expect(row?.provider_message_id).toMatch(/^fake-/);
    expect(row?.accepted_at).not.toBeNull();
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].message).toMatchObject({
      to: 'kunde@example.at',
      from: { email: FROM, name: 'Werkstatt E2E' },
      replyTo: { email: 'werkstatt@example.at', name: 'Werkstatt E2E' },
      subject: 'Auftrag Nr. E2E-1',
      text: 'Guten Tag,',
    });
    expect(fake.sent[0].options.idempotencyKey).toBe(id);
  });

  it('a second delivery of an accepted row sends nothing more', async () => {
    const id = await enqueue(tenantA);
    await deliver(id, tenantA).expect(204);

    await deliver(id, tenantA).expect(204);

    expect(fake.sent).toHaveLength(1);
    expect((await readRow(tenantA, id))?.attempts).toBe(1);
  });

  it('mode off records SUPPRESSED and calls no provider', async () => {
    setEnv({ NOTIFICATION_EMAIL_MODE: 'off' });
    const id = await enqueue(tenantA);

    await deliver(id, tenantA).expect(204);

    expect(await readRow(tenantA, id)).toMatchObject({
      status: 'SUPPRESSED',
      suppressed_reason: 'EMAIL_DISABLED',
    });
    expect(fake.sent).toHaveLength(0);
  });

  it('a suspended tenant sends nothing and keeps its row waiting, then sends after reactivation', async () => {
    const id = await enqueue(tenantA);
    await basePrisma.tenant.update({
      where: { id: tenantA },
      data: { is_active: false },
    });
    try {
      await deliver(id, tenantA).expect(204);
    } finally {
      await basePrisma.tenant.update({
        where: { id: tenantA },
        data: { is_active: true },
      });
    }

    expect(await readRow(tenantA, id)).toMatchObject({
      status: 'PENDING',
      attempts: 0,
    });
    expect(fake.sent).toHaveLength(0);

    await deliver(id, tenantA).expect(204);

    expect(await readRow(tenantA, id)).toMatchObject({
      status: 'ACCEPTED',
      attempts: 1,
    });
    expect(fake.sent).toHaveLength(1);
  });

  it('live mode refuses a recipient outside the allowlist', async () => {
    setEnv({
      NOTIFICATION_EMAIL_MODE: 'live',
      NOTIFICATION_EMAIL_RECIPIENT_ALLOWLIST: 'jemand@example.at',
    });
    const id = await enqueue(tenantA);

    await deliver(id, tenantA).expect(204);

    expect(await readRow(tenantA, id)).toMatchObject({
      status: 'SUPPRESSED',
      suppressed_reason: 'RECIPIENT_NOT_ALLOWLISTED',
    });
    expect(fake.sent).toHaveLength(0);
  });

  it('live mode to an allowlisted recipient reaches only the inert stub, which fails permanently', async () => {
    setEnv({
      NOTIFICATION_EMAIL_MODE: 'live',
      NOTIFICATION_EMAIL_PROVIDER: 'brevo',
      NOTIFICATION_EMAIL_RECIPIENT_ALLOWLIST: 'kunde@example.at',
    });
    const id = await enqueue(tenantA);

    await deliver(id, tenantA).expect(204);

    expect(await readRow(tenantA, id)).toMatchObject({
      status: 'FAILED',
      last_error_code: 'PROVIDER_NOT_CONFIGURED',
    });
    expect(fake.sent).toHaveLength(0);
  });

  it('a transient failure schedules a retry with backoff, and a later attempt can accept', async () => {
    const id = await enqueue(tenantA);
    fake.failNext(
      new EmailProviderError('transient', 'NETWORK', 'connection reset'),
    );

    const before = Date.now();
    await deliver(id, tenantA).expect(204);

    const retried = await readRow(tenantA, id);
    expect(retried).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      last_error_code: 'NETWORK',
      lease_token: null,
    });
    expect(retried!.next_attempt_at.getTime()).toBeGreaterThanOrEqual(
      before + 55_000,
    );

    await tenantPrisma(tenantA).notificationOutbox.updateMany({
      where: { id, tenant_id: tenantA },
      data: { next_attempt_at: new Date(0) },
    });
    await deliver(id, tenantA).expect(204);

    expect(await readRow(tenantA, id)).toMatchObject({
      status: 'ACCEPTED',
      attempts: 2,
    });
  });

  it('a row that used its last attempt fails permanently', async () => {
    const id = await enqueue(tenantA);
    await tenantPrisma(tenantA).notificationOutbox.updateMany({
      where: { id, tenant_id: tenantA },
      data: { attempts: 4 },
    });
    fake.failNext(
      new EmailProviderError('transient', 'PROVIDER_5XX', 'bad gateway'),
    );

    await deliver(id, tenantA).expect(204);

    expect(await readRow(tenantA, id)).toMatchObject({
      status: 'FAILED',
      attempts: 5,
      last_error_code: 'MAX_ATTEMPTS_EXCEEDED',
    });
  });

  it('refuses a signature made with another secret, a foreign tenant header and a payload for another row', async () => {
    const id = await enqueue(tenantA);

    await deliver(id, tenantA, 'another-secret').expect(401);
    await api()
      .post(`/api/notifications/outbox/${id}/worker`)
      .set('x-cloud-tasks-secret', SECRET)
      .set('x-tenant-id', tenantB)
      .send(
        signNotificationTaskPayload(
          { outboxId: id, tenantId: tenantA },
          SECRET,
        ),
      )
      .expect(403);
    await api()
      .post(`/api/notifications/outbox/${randomUUID()}/worker`)
      .set('x-cloud-tasks-secret', SECRET)
      .set('x-tenant-id', tenantA)
      .send(
        signNotificationTaskPayload(
          { outboxId: id, tenantId: tenantA },
          SECRET,
        ),
      )
      .expect(403);

    expect(fake.sent).toHaveLength(0);
    expect((await readRow(tenantA, id))?.status).toBe('PENDING');
  });

  it("tenant isolation: a validly signed call for tenant B cannot deliver tenant A's row", async () => {
    const id = await enqueue(tenantA);

    await deliver(id, tenantB).expect(204);

    expect(await readRow(tenantA, id)).toMatchObject({
      status: 'PENDING',
      attempts: 0,
    });
    expect(await readRow(tenantB, id)).toBeNull();
    expect(fake.sent).toHaveLength(0);
  });

  it('the recovery sweep wakes due rows of each tenant, and leaves a row that is not yet due', async () => {
    const past = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const dueA = await enqueue(tenantA, { now: past });
    const dueB = await enqueue(tenantB, { now: past });
    const notYetDue = await enqueue(tenantA, {
      now: new Date(Date.now() + 60 * 60 * 1000),
    });
    const cloud = app.get(NotificationCloudTasksService);
    setEnv({
      CLOUD_TASKS_NOTIFICATION_QUEUE: 'notification-queue',
      CLOUD_TASKS_LOCATION: 'europe-west3',
      CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL: 'https://worker.example/api',
      CLOUD_TASKS_INVOKER_SA: 'invoker@example.iam.gserviceaccount.com',
      CLOUD_TASKS_ENABLED: 'true',
    });
    const wake = jest
      .spyOn(cloud, 'enqueueWakeUp')
      .mockResolvedValue(undefined);

    try {
      await app.get(NotificationOutboxRecoveryService).recover();
      // Assert before restoring: mockRestore() also clears the recorded calls.
      expect(wake).toHaveBeenCalledWith({ outboxId: dueA, tenantId: tenantA });
      expect(wake).toHaveBeenCalledWith({ outboxId: dueB, tenantId: tenantB });
      expect(wake).not.toHaveBeenCalledWith(
        expect.objectContaining({ outboxId: notYetDue }),
      );
    } finally {
      wake.mockRestore();
      setEnv({
        CLOUD_TASKS_NOTIFICATION_QUEUE: undefined,
        CLOUD_TASKS_LOCATION: undefined,
        CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL: undefined,
        CLOUD_TASKS_INVOKER_SA: undefined,
        CLOUD_TASKS_ENABLED: undefined,
      });
    }
  });

  it('a wake-up reclaims a claim whose lease expired, and sends the row once', async () => {
    const id = await enqueue(tenantA);
    await tenantPrisma(tenantA).notificationOutbox.updateMany({
      where: { id, tenant_id: tenantA },
      data: {
        status: 'SENDING',
        attempts: 1,
        lease_token: 'lost-claim',
        lease_expires_at: new Date(Date.now() - 60_000),
      },
    });

    await deliver(id, tenantA).expect(204);

    expect(await readRow(tenantA, id)).toMatchObject({
      status: 'ACCEPTED',
      attempts: 2,
    });
    expect(fake.sent).toHaveLength(1);
  });

  it('a stale attempt cannot overwrite a row that another attempt has taken over', async () => {
    const id = await enqueue(tenantA);
    const send = fake.send.bind(fake);
    const takeOver = jest
      .spyOn(fake, 'send')
      .mockImplementationOnce(async (message, options) => {
        // While this attempt is sending, another attempt takes the row over.
        await tenantPrisma(tenantA).notificationOutbox.updateMany({
          where: { id, tenant_id: tenantA },
          data: {
            lease_token: 'takeover',
            lease_expires_at: new Date(Date.now() + 120_000),
          },
        });
        return send(message, options);
      });

    try {
      await deliver(id, tenantA).expect(204);
    } finally {
      takeOver.mockRestore();
    }

    expect(await readRow(tenantA, id)).toMatchObject({
      status: 'SENDING',
      lease_token: 'takeover',
    });
  });

  it('a notice older than the sending window is never sent, and the sweep fails it', async () => {
    const id = await enqueue(tenantA);
    const eightDaysAgo = new Date(Date.now() - 8 * DAY_MS);
    await tenantPrisma(tenantA).notificationOutbox.updateMany({
      where: { id, tenant_id: tenantA },
      data: { createdAt: eightDaysAgo, next_attempt_at: eightDaysAgo },
    });

    await deliver(id, tenantA).expect(204);

    expect(await readRow(tenantA, id)).toMatchObject({
      status: 'PENDING',
      attempts: 0,
    });
    expect(fake.sent).toHaveLength(0);

    await app.get(NotificationOutboxRecoveryService).recover();

    expect(await readRow(tenantA, id)).toMatchObject({
      status: 'FAILED',
      last_error_code: 'STALE_UNSENT',
    });
  });

  it('the sweep releases an expired claim after its backoff, and fails one that used every attempt', async () => {
    const retry = await enqueue(tenantA);
    const exhausted = await enqueue(tenantA);
    const expiredAt = new Date(Date.now() - 60_000);
    await tenantPrisma(tenantA).notificationOutbox.updateMany({
      where: { id: retry, tenant_id: tenantA },
      data: {
        status: 'SENDING',
        attempts: 2,
        lease_token: 'lost-retry',
        lease_expires_at: expiredAt,
      },
    });
    await tenantPrisma(tenantA).notificationOutbox.updateMany({
      where: { id: exhausted, tenant_id: tenantA },
      data: {
        status: 'SENDING',
        attempts: 5,
        lease_token: 'lost-last',
        lease_expires_at: expiredAt,
      },
    });
    setEnv({
      CLOUD_TASKS_NOTIFICATION_QUEUE: 'notification-queue',
      CLOUD_TASKS_LOCATION: 'europe-west3',
      CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL: 'https://worker.example/api',
      CLOUD_TASKS_INVOKER_SA: 'invoker@example.iam.gserviceaccount.com',
      CLOUD_TASKS_ENABLED: 'true',
    });
    const wake = jest
      .spyOn(app.get(NotificationCloudTasksService), 'enqueueWakeUp')
      .mockResolvedValue(undefined);

    try {
      await app.get(NotificationOutboxRecoveryService).recover();

      const released = await readRow(tenantA, retry);
      expect(released).toMatchObject({
        status: 'PENDING',
        last_error_code: 'LEASE_EXPIRED',
        attempts: 2,
      });
      const dueInSeconds =
        ((released?.next_attempt_at.getTime() ?? 0) - Date.now()) / 1000;
      expect(dueInSeconds).toBeGreaterThan(290);
      expect(dueInSeconds).toBeLessThanOrEqual(300);
      // Assert before restoring: mockRestore() also clears the recorded calls.
      expect(wake).toHaveBeenCalledWith({
        outboxId: retry,
        tenantId: tenantA,
        delaySeconds: 300,
      });
      expect(await readRow(tenantA, exhausted)).toMatchObject({
        status: 'FAILED',
        last_error_code: 'LEASE_EXPIRED',
      });
      expect(wake).not.toHaveBeenCalledWith(
        expect.objectContaining({ outboxId: exhausted }),
      );
    } finally {
      wake.mockRestore();
      setEnv({
        CLOUD_TASKS_NOTIFICATION_QUEUE: undefined,
        CLOUD_TASKS_LOCATION: undefined,
        CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL: undefined,
        CLOUD_TASKS_INVOKER_SA: undefined,
        CLOUD_TASKS_ENABLED: undefined,
      });
    }
  });

  it('the worker route is not served where no sender is configured', async () => {
    const id = await enqueue(tenantA);
    setEnv({ NOTIFICATION_EMAIL_MODE: undefined });
    try {
      await deliver(id, tenantA).expect(404);
    } finally {
      setEnv({ NOTIFICATION_EMAIL_MODE: 'fake' });
    }

    expect(await readRow(tenantA, id)).toMatchObject({
      status: 'PENDING',
      attempts: 0,
    });
    expect(fake.sent).toHaveLength(0);
  });

  it('the body purge clears a terminal body after 90 days and keeps a recent one', async () => {
    const old = await enqueue(tenantA);
    const recent = await enqueue(tenantA);
    await deliver(old, tenantA).expect(204);
    await deliver(recent, tenantA).expect(204);
    // The claim refuses a notice older than the sending window, so the old one is sent while fresh and
    // only then backdated past the purge cut-off.
    await tenantPrisma(tenantA).notificationOutbox.updateMany({
      where: { id: old, tenant_id: tenantA },
      data: { createdAt: new Date(Date.now() - 100 * DAY_MS) },
    });

    await app.get(NotificationOutboxRetentionService).purgeBodies();

    expect(await readRow(tenantA, old)).toMatchObject({
      body: null,
      status: 'ACCEPTED',
    });
    expect((await readRow(tenantA, old))?.body_purged_at).not.toBeNull();
    expect(await readRow(tenantA, recent)).toMatchObject({
      body: 'Guten Tag,',
    });
  });
});
