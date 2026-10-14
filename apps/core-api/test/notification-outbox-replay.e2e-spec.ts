import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { NotificationOutboxRecoveryService } from '../src/notifications/notification-outbox-recovery.service.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

/**
 * AUT-356 phase 6: the admin replay of dead letters (ADR-0025 §6). A replay only moves FAILED rows back to PENDING
 * with a fresh attempt budget. The worker still does the send, and the Cloud Tasks queue is not configured here, so
 * each replayed row keeps its wake-up failure in the log and stays PENDING for the recovery sweep.
 */
describe('Notification outbox replay (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let tenantId: string;
  let otherTenantId: string;
  let adminToken: string;

  const api = () => request(app.getHttpServer());
  const adminAuth = () => ({ Authorization: `Bearer ${adminToken}` });
  const tenantPrisma = (id: string) => createTenantAwarePrisma(basePrisma, id);

  /** The role is read from the tenant membership, not from the token, so a test changes the membership itself. */
  async function setTenantMemberRole(role: 'ADMIN' | 'SALES') {
    await tenantPrisma(tenantId).tenantMember.updateMany({
      where: { tenant_id: tenantId },
      data: { role },
    });
  }

  /** A customer estimate email as a failed send leaves it: FAILED, with its body hash still stored. */
  function failedRow(
    overrides: Partial<Prisma.NotificationOutboxUncheckedCreateInput> = {},
  ): Prisma.NotificationOutboxUncheckedCreateInput {
    return {
      tenant_id: tenantId,
      event_type: 'CUSTOMER_ESTIMATE_SENT',
      idempotency_key: randomUUID(),
      channel: 'EMAIL',
      recipient_kind: 'CUSTOMER',
      recipient_email: 'kunde@example.test',
      subject: 'Ihr Kostenvoranschlag',
      body: 'Guten Tag,',
      body_sha256: 'a'.repeat(64),
      status: 'FAILED',
      attempts: 5,
      failed_at: new Date(),
      last_error_code: 'PROVIDER_REJECTED',
      ...overrides,
    };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    basePrisma = app.get<PrismaService>(PrismaService);
    const testTenant = await createTestTenant(basePrisma);
    tenantId = testTenant.tenantId;
    adminToken = createTestAuthToken(app.get(AuthService), testTenant);

    const otherTenant = await createTestTenant(basePrisma);
    otherTenantId = otherTenant.tenantId;
  });

  afterAll(async () => {
    for (const id of [tenantId, otherTenantId]) {
      if (id) {
        await tenantPrisma(id).notificationOutbox.deleteMany({});
        await cleanupTestTenantGraph(basePrisma, id);
      }
    }
    await teardownTestApp(app, basePrisma);
  });

  it('sends each failed row again, and reports every row it refuses with its code', async () => {
    const prisma = tenantPrisma(tenantId);
    const replayable = await prisma.notificationOutbox.create({
      data: failedRow(),
    });
    const inApp = await prisma.notificationOutbox.create({
      data: failedRow({ channel: 'IN_APP', body: null, body_sha256: null }),
    });
    const accepted = await prisma.notificationOutbox.create({
      data: failedRow({ status: 'ACCEPTED', failed_at: null }),
    });
    const purged = await prisma.notificationOutbox.create({
      data: failedRow({ body: null, body_purged_at: new Date() }),
    });
    const noHash = await prisma.notificationOutbox.create({
      data: failedRow({ body_sha256: null }),
    });
    // A failed estimate email: the write that failed it removed the approval link from the body.
    const linkRedacted = await prisma.notificationOutbox.create({
      data: failedRow({
        body: 'Guten Tag, Ihr Link: [Link entfernt]',
      }),
    });
    // A PENDING notice older than the sending window, failed the way production fails it: by the recovery sweep.
    const stale = await prisma.notificationOutbox.create({
      data: failedRow({
        status: 'PENDING',
        attempts: 0,
        failed_at: null,
        last_error_code: null,
        createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      }),
    });
    await app.get(NotificationOutboxRecoveryService).recover();
    const unknown = randomUUID();

    const response = await api()
      .post('/api/notifications/outbox/replay')
      .set(adminAuth())
      .send({
        ids: [
          replayable.id,
          inApp.id,
          accepted.id,
          purged.id,
          noHash.id,
          linkRedacted.id,
          stale.id,
          unknown,
        ],
      })
      .expect(200);

    expect(response.body).toEqual({
      replayed: [replayable.id, inApp.id],
      refused: [
        { id: accepted.id, code: 'NOT_FAILED' },
        { id: purged.id, code: 'BODY_PURGED' },
        { id: noHash.id, code: 'BODY_MISSING' },
        { id: linkRedacted.id, code: 'LINK_REDACTED' },
        { id: stale.id, code: 'STALE_UNSENT' },
        { id: unknown, code: 'NOT_FOUND' },
      ],
    });
    const after = await prisma.notificationOutbox.findFirstOrThrow({
      where: { id: replayable.id },
    });
    expect(after).toMatchObject({
      status: 'PENDING',
      attempts: 0,
      failed_at: null,
      lease_token: null,
      lease_expires_at: null,
    });
  });

  it('refuses a second replay of a row the first one already moved to PENDING', async () => {
    const row = await tenantPrisma(tenantId).notificationOutbox.create({
      data: failedRow(),
    });

    await api()
      .post('/api/notifications/outbox/replay')
      .set(adminAuth())
      .send({ ids: [row.id] })
      .expect(200);
    const second = await api()
      .post('/api/notifications/outbox/replay')
      .set(adminAuth())
      .send({ ids: [row.id] })
      .expect(200);

    expect(second.body).toEqual({
      replayed: [],
      refused: [{ id: row.id, code: 'NOT_FAILED' }],
    });
  });

  it('treats a row of another tenant as not found, and leaves it failed', async () => {
    const foreign = await tenantPrisma(otherTenantId).notificationOutbox.create(
      { data: failedRow({ tenant_id: otherTenantId }) },
    );

    const response = await api()
      .post('/api/notifications/outbox/replay')
      .set(adminAuth())
      .send({ ids: [foreign.id] })
      .expect(200);

    expect(response.body).toEqual({
      replayed: [],
      refused: [{ id: foreign.id, code: 'NOT_FOUND' }],
    });
    const after = await tenantPrisma(
      otherTenantId,
    ).notificationOutbox.findFirstOrThrow({ where: { id: foreign.id } });
    expect(after.status).toBe('FAILED');
  });

  it('refuses a sales member, who may send estimates but not replay mail, and changes no row', async () => {
    const row = await tenantPrisma(tenantId).notificationOutbox.create({
      data: failedRow(),
    });

    await setTenantMemberRole('SALES');
    try {
      await api()
        .post('/api/notifications/outbox/replay')
        .set(adminAuth())
        .send({ ids: [row.id] })
        .expect(403);
    } finally {
      await setTenantMemberRole('ADMIN');
    }

    const after = await tenantPrisma(
      tenantId,
    ).notificationOutbox.findFirstOrThrow({ where: { id: row.id } });
    expect(after.status).toBe('FAILED');
  });

  it('answers 401 without a session', async () => {
    await api()
      .post('/api/notifications/outbox/replay')
      .send({ ids: [randomUUID()] })
      .expect(401);
  });

  it('rejects a request outside the contract before it reads any row', async () => {
    const tooMany = Array.from({ length: 51 }, () => randomUUID());

    for (const body of [
      {},
      { ids: [] },
      { ids: ['not-a-uuid'] },
      { ids: tooMany },
    ]) {
      await api()
        .post('/api/notifications/outbox/replay')
        .set(adminAuth())
        .send(body)
        .expect(400);
    }
  });

  it('rejects a repeated id, since one request must not name a row twice', async () => {
    const id = randomUUID();

    await api()
      .post('/api/notifications/outbox/replay')
      .set(adminAuth())
      .send({ ids: [id, id] })
      .expect(400);
  });
});
