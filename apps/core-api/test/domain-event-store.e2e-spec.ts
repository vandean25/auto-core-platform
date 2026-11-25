import { createE2eApp } from './helpers/e2e-suite.js';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { DomainEventConsumerRecoveryService } from '../src/domain-event-consumer/domain-event-consumer-recovery.service.js';
import { WORKSHOP_ESTIMATE_DECIDED_INTERNAL_NOTICE_CONSUMER } from '../src/domain-event-consumer/domain-event-consumer.constants.js';
import { DOMAIN_EVENT_TYPES } from '../src/domain-event-store/domain-event.constants.js';
import { encodeDomainEventFeedCursor } from '../src/domain-event-store/domain-event.cursor.js';
import { DomainEventStoreService } from '../src/domain-event-store/domain-event-store.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { WorkshopEstimateDecidedConsumerService } from '../src/workshop/workshop-estimate-decided-consumer.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('Domain event store (e2e, AUT-536)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let siteId: string;
  let adminToken: string;
  let customerId: string;
  let vehicleId: string;
  let bayId: string;

  const auth = () => ({ Authorization: `Bearer ${adminToken}` });

  beforeAll(async () => {
    app = await createE2eApp();

    basePrisma = app.get(PrismaService);
    const testTenant = await createTestTenant(basePrisma, 'domain-event-store');
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    siteId = await resolveTestMainSiteId(basePrisma, tenantId);
    adminToken = createTestAuthToken(app.get(AuthService), testTenant);

    const customer = await prisma.customer.create({
      data: {
        tenant_id: tenantId,
        first_name: 'Pilot',
        last_name: 'Customer',
        email: `domain-events-${Date.now()}@example.com`,
        type: 'PRIVATE',
      },
    });
    customerId = customer.id;
    const vehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        customer_id: customerId,
        make: 'VW',
        model: 'Polo',
        year: 2020,
        vin: `VIN-DOMAIN-${Date.now()}`,
      },
    });
    vehicleId = vehicle.id;
    const bay = await prisma.bay.create({
      data: {
        tenant_id: tenantId,
        name: `Domain Bay ${Date.now()}`,
        is_active: true,
        sort_order: 1,
        site_id: siteId,
      },
    });
    bayId = bay.id;
  });

  afterAll(async () => {
    if (tenantId) {
      await cleanupTestTenantGraph(basePrisma, tenantId);
    }
    await teardownTestApp(app, basePrisma);
  });

  it('writes workshop_order.scheduled.v1 in the same transaction as a scheduled create', async () => {
    const scheduled = await request(app.getHttpServer())
      .post('/api/workshop/orders')
      .set(auth())
      .send({
        customerId,
        vehicleId,
        status: 'SCHEDULED',
        bayId,
        scheduledStartAt: '2026-09-01T08:00:00.000Z',
        scheduledEndAt: '2026-09-01T09:00:00.000Z',
      })
      .expect(201);

    const events = await prisma.domainEvent.findMany({
      where: {
        tenant_id: tenantId,
        event_type: DOMAIN_EVENT_TYPES.workshopOrderScheduledV1,
        entity_id: scheduled.body.id,
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      site_id: siteId,
      schema_version: 1,
      payload: {},
    });
  });

  it('rolls back the workshop order when domain event append fails on scheduled create', async () => {
    const rollbackVehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        customer_id: customerId,
        make: 'VW',
        model: 'Golf',
        year: 2019,
        vin: `VIN-ROLLBACK-${Date.now()}`,
      },
    });
    const domainEventStore = app.get(DomainEventStoreService);
    const appendSpy = jest
      .spyOn(domainEventStore, 'appendInTx')
      .mockRejectedValueOnce(new Error('simulated domain event failure'));

    await request(app.getHttpServer())
      .post('/api/workshop/orders')
      .set(auth())
      .send({
        customerId,
        vehicleId: rollbackVehicle.id,
        status: 'SCHEDULED',
        bayId,
        scheduledStartAt: '2026-09-02T08:00:00.000Z',
        scheduledEndAt: '2026-09-02T09:00:00.000Z',
      })
      .expect(500);

    const order = await prisma.workshopOrder.findFirst({
      where: { tenant_id: tenantId, vehicle_id: rollbackVehicle.id },
    });
    expect(order).toBeNull();

    appendSpy.mockRestore();
  });

  it('pages the feed by monotonic sequence with a versioned cursor', async () => {
    const pagingVehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        customer_id: customerId,
        make: 'Audi',
        model: 'A3',
        year: 2021,
        vin: `VIN-PAGING-${Date.now()}`,
      },
    });
    await request(app.getHttpServer())
      .post('/api/workshop/orders')
      .set(auth())
      .send({
        customerId,
        vehicleId: pagingVehicle.id,
        status: 'SCHEDULED',
        bayId,
        scheduledStartAt: '2026-09-03T08:00:00.000Z',
        scheduledEndAt: '2026-09-03T09:00:00.000Z',
      })
      .expect(201);

    const first = await request(app.getHttpServer())
      .get('/api/agent/domain-events')
      .query({ pageSize: 1 })
      .set(auth())
      .expect(200);

    expect(first.body.data).toHaveLength(1);
    expect(first.body.data[0].sequence).toBeDefined();
    const cursor = first.body.meta.next_cursor as string;
    expect(cursor).toBeTruthy();
    expect(typeof cursor).toBe('string');

    const second = await request(app.getHttpServer())
      .get('/api/agent/domain-events')
      .query({ pageSize: 1, cursor })
      .set(auth())
      .expect(200);

    expect(second.body.data[0].sequence).not.toBe(first.body.data[0].sequence);

    const replay = await request(app.getHttpServer())
      .get('/api/agent/domain-events')
      .query({ pageSize: 1, cursor })
      .set(auth())
      .expect(200);

    expect(replay.body).toEqual(second.body);
  });

  it('rejects a foreign tenant cursor without leaking rows', async () => {
    const foreign = encodeDomainEventFeedCursor({
      sequence: BigInt(999_999),
      id: '00000000-0000-4000-8000-000000000099',
    });

    await request(app.getHttpServer())
      .get('/api/agent/domain-events')
      .query({ cursor: foreign })
      .set(auth())
      .expect(400);
  });

  // Regression (AUT-1052): out-of-order commit must not advance feed/consumer/recovery past an open transaction.
  it('hides out-of-order committed events from feed, consumer, and recovery until earlier tx commits without duplicate delivery', async () => {
    const isolated = await createTestTenant(basePrisma, 'domain-event-ooo');
    const isolatedSiteId = await resolveTestMainSiteId(
      basePrisma,
      isolated.tenantId,
    );
    const isolatedToken = createTestAuthToken(app.get(AuthService), isolated);
    const isolatedPrisma = createTenantAwarePrisma(
      basePrisma,
      isolated.tenantId,
    );
    const domainEventStore = app.get(DomainEventStoreService);
    const consumer = app.get(WorkshopEstimateDecidedConsumerService);
    const recovery = app.get(DomainEventConsumerRecoveryService);

    const txAInserted = createDeferred<void>();
    const releaseTxA = createDeferred<void>();
    let txAPromise: Promise<unknown> | null = null;

    try {
      const entityA = randomUUID();
      const entityB = randomUUID();
      const traceA = randomUUID();
      const traceB = randomUUID();

      txAPromise = isolatedPrisma.$transaction(
        async (tx) => {
          const appended = await domainEventStore.appendInTx(tx, {
            tenantId: isolated.tenantId,
            siteId: isolatedSiteId,
            entityId: entityA,
            eventType: DOMAIN_EVENT_TYPES.workshopEstimateDecidedV1,
            occurrenceKey: `test-ooo-a-${entityA}`,
            occurredAt: new Date('2026-11-25T10:00:00.000Z'),
            traceId: traceA,
            payload: {},
          });
          txAInserted.resolve();
          await releaseTxA.promise;
          return appended;
        },
        { timeout: 20_000 },
      );
      txAPromise.catch(txAInserted.reject);

      await txAInserted.promise;

      const txBPromise = isolatedPrisma.$transaction(
        async (tx) =>
          domainEventStore.appendInTx(tx, {
            tenantId: isolated.tenantId,
            siteId: isolatedSiteId,
            entityId: entityB,
            eventType: DOMAIN_EVENT_TYPES.workshopEstimateDecidedV1,
            occurrenceKey: `test-ooo-b-${entityB}`,
            occurredAt: new Date('2026-11-25T10:00:01.000Z'),
            traceId: traceB,
            payload: {},
          }),
        { timeout: 20_000 },
      );

      // Between commits: tx A is still open and tx B is serialized behind it. Neither event may be visible.
      const feedBetween = await request(app.getHttpServer())
        .get('/api/agent/domain-events')
        .set({ Authorization: `Bearer ${isolatedToken}` })
        .expect(200);
      expect(feedBetween.body.data).toEqual([]);

      const consumerCountBetween = await consumer.processTenantBatch(
        isolated.tenantId,
      );
      expect(consumerCountBetween).toBe(0);

      await recovery.run();
      const progressBetween =
        await isolatedPrisma.domainEventConsumerProgress.findFirst({
          where: {
            tenant_id: isolated.tenantId,
            consumer_key: WORKSHOP_ESTIMATE_DECIDED_INTERNAL_NOTICE_CONSUMER,
          },
        });
      expect(progressBetween?.cursor_sequence ?? BigInt(0)).toBe(BigInt(0));
      expect(
        await isolatedPrisma.domainEventConsumerDelivery.count({
          where: {
            tenant_id: isolated.tenantId,
            consumer_key: WORKSHOP_ESTIMATE_DECIDED_INTERNAL_NOTICE_CONSUMER,
          },
        }),
      ).toBe(0);

      // Now commit tx A; tx B unblocks and commits next. Both events must appear in sequence order without skipping or duplicating.
      releaseTxA.resolve();
      const [appendedA, appendedB] = (await Promise.all([
        txAPromise,
        txBPromise,
      ])) as [
        { eventId: string; sequence: bigint },
        { eventId: string; sequence: bigint },
      ];
      txAPromise = null;
      expect(appendedB).not.toBeNull();
      expect(appendedA.sequence < appendedB.sequence).toBe(true);

      const feedAfter = await request(app.getHttpServer())
        .get('/api/agent/domain-events')
        .set({ Authorization: `Bearer ${isolatedToken}` })
        .expect(200);
      expect(feedAfter.body.data.map((row: { event_id: string }) => row.event_id)).toEqual([
        appendedA.eventId,
        appendedB.eventId,
      ]);

      await recovery.run();
      const progressAfter =
        await isolatedPrisma.domainEventConsumerProgress.findFirst({
          where: {
            tenant_id: isolated.tenantId,
            consumer_key: WORKSHOP_ESTIMATE_DECIDED_INTERNAL_NOTICE_CONSUMER,
          },
        });
      expect(progressAfter?.cursor_sequence).toBe(appendedB.sequence);
      expect(
        await isolatedPrisma.domainEventConsumerDelivery.count({
          where: {
            tenant_id: isolated.tenantId,
            consumer_key: WORKSHOP_ESTIMATE_DECIDED_INTERNAL_NOTICE_CONSUMER,
          },
        }),
      ).toBe(2);

      // Replay: resetting cursor and re-running consumer must not create duplicate deliveries.
      await isolatedPrisma.domainEventConsumerProgress.updateMany({
        where: {
          tenant_id: isolated.tenantId,
          consumer_key: WORKSHOP_ESTIMATE_DECIDED_INTERNAL_NOTICE_CONSUMER,
        },
        data: { cursor_sequence: BigInt(0), cursor_event_id: null },
      });
      await consumer.processTenantBatch(isolated.tenantId);
      expect(
        await isolatedPrisma.domainEventConsumerDelivery.count({
          where: {
            tenant_id: isolated.tenantId,
            consumer_key: WORKSHOP_ESTIMATE_DECIDED_INTERNAL_NOTICE_CONSUMER,
          },
        }),
      ).toBe(2);
    } finally {
      releaseTxA.resolve();
      if (txAPromise) {
        await txAPromise.catch(() => undefined);
      }
      await isolatedPrisma.domainEventConsumerDelivery.deleteMany({
        where: { tenant_id: isolated.tenantId },
      });
      await isolatedPrisma.domainEventConsumerProgress.deleteMany({
        where: { tenant_id: isolated.tenantId },
      });
      await cleanupTestTenantGraph(basePrisma, isolated.tenantId);
    }
  });

  // Regression (AUT-1052): older xid (from an earlier write) must not insert a higher sequence and commit ahead of a paused lower-sequence append.
  it('serializes per-tenant appends when an older transaction writes before appending and a newer transaction pauses before commit', async () => {
    const isolated = await createTestTenant(basePrisma, 'domain-event-xid-race');
    const isolatedSiteId = await resolveTestMainSiteId(
      basePrisma,
      isolated.tenantId,
    );
    const isolatedToken = createTestAuthToken(app.get(AuthService), isolated);
    const isolatedPrisma = createTenantAwarePrisma(
      basePrisma,
      isolated.tenantId,
    );
    const domainEventStore = app.get(DomainEventStoreService);
    const consumer = app.get(WorkshopEstimateDecidedConsumerService);
    const recovery = app.get(DomainEventConsumerRecoveryService);

    const txAUpdated = createDeferred<void>();
    const releaseTxAAppend = createDeferred<void>();
    const txBAppended = createDeferred<void>();
    const releaseTxBCommit = createDeferred<void>();
    let txAPromise: Promise<unknown> | null = null;
    let txBPromise: Promise<unknown> | null = null;

    try {
      const entityA = randomUUID();
      const entityB = randomUUID();

      txAPromise = isolatedPrisma.$transaction(
        async (tx) => {
          await tx.site.update({
            where: { id: isolatedSiteId },
            data: { name: 'AUT-1052 xid-before-append' },
          });
          txAUpdated.resolve();
          await releaseTxAAppend.promise;
          return domainEventStore.appendInTx(tx, {
            tenantId: isolated.tenantId,
            siteId: isolatedSiteId,
            entityId: entityA,
            eventType: DOMAIN_EVENT_TYPES.workshopEstimateDecidedV1,
            occurrenceKey: `test-xid-race-a-${entityA}`,
            occurredAt: new Date('2026-11-25T10:00:00.000Z'),
            traceId: randomUUID(),
            payload: {},
          });
        },
        { timeout: 20_000 },
      );
      txAPromise.catch(txAUpdated.reject);

      await txAUpdated.promise;

      txBPromise = isolatedPrisma.$transaction(
        async (tx) => {
          const appended = await domainEventStore.appendInTx(tx, {
            tenantId: isolated.tenantId,
            siteId: isolatedSiteId,
            entityId: entityB,
            eventType: DOMAIN_EVENT_TYPES.workshopEstimateDecidedV1,
            occurrenceKey: `test-xid-race-b-${entityB}`,
            occurredAt: new Date('2026-11-25T10:00:01.000Z'),
            traceId: randomUUID(),
            payload: {},
          });
          txBAppended.resolve();
          await releaseTxBCommit.promise;
          return appended;
        },
        { timeout: 20_000 },
      );
      txBPromise.catch(txBAppended.reject);

      await txBAppended.promise;

      // Release txA to attempt append + commit while txB holds the per-tenant advisory lock before commit.
      releaseTxAAppend.resolve();

      const feedBetween = await request(app.getHttpServer())
        .get('/api/agent/domain-events')
        .set({ Authorization: `Bearer ${isolatedToken}` })
        .expect(200);
      expect(feedBetween.body.data).toEqual([]);

      const consumerCountBetween = await consumer.processTenantBatch(
        isolated.tenantId,
      );
      expect(consumerCountBetween).toBe(0);

      await recovery.run();
      const progressBetween =
        await isolatedPrisma.domainEventConsumerProgress.findFirst({
          where: {
            tenant_id: isolated.tenantId,
            consumer_key: WORKSHOP_ESTIMATE_DECIDED_INTERNAL_NOTICE_CONSUMER,
          },
        });
      expect(progressBetween?.cursor_sequence ?? BigInt(0)).toBe(BigInt(0));

      releaseTxBCommit.resolve();
      const [appendedA, appendedB] = (await Promise.all([
        txAPromise,
        txBPromise,
      ])) as [
        { eventId: string; sequence: bigint },
        { eventId: string; sequence: bigint },
      ];
      txAPromise = null;
      txBPromise = null;

      expect(appendedB.sequence < appendedA.sequence).toBe(true);

      const feedAfter = await request(app.getHttpServer())
        .get('/api/agent/domain-events')
        .set({ Authorization: `Bearer ${isolatedToken}` })
        .expect(200);
      expect(
        feedAfter.body.data.map((row: { event_id: string }) => row.event_id),
      ).toEqual([appendedB.eventId, appendedA.eventId]);

      await recovery.run();
      const progressAfter =
        await isolatedPrisma.domainEventConsumerProgress.findFirst({
          where: {
            tenant_id: isolated.tenantId,
            consumer_key: WORKSHOP_ESTIMATE_DECIDED_INTERNAL_NOTICE_CONSUMER,
          },
        });
      expect(progressAfter?.cursor_sequence).toBe(appendedA.sequence);
      expect(
        await isolatedPrisma.domainEventConsumerDelivery.count({
          where: {
            tenant_id: isolated.tenantId,
            consumer_key: WORKSHOP_ESTIMATE_DECIDED_INTERNAL_NOTICE_CONSUMER,
          },
        }),
      ).toBe(2);
    } finally {
      releaseTxAAppend.resolve();
      releaseTxBCommit.resolve();
      if (txAPromise) {
        await txAPromise.catch(() => undefined);
      }
      if (txBPromise) {
        await txBPromise.catch(() => undefined);
      }
      await isolatedPrisma.domainEventConsumerDelivery.deleteMany({
        where: { tenant_id: isolated.tenantId },
      });
      await isolatedPrisma.domainEventConsumerProgress.deleteMany({
        where: { tenant_id: isolated.tenantId },
      });
      await cleanupTestTenantGraph(basePrisma, isolated.tenantId);
    }
  });

  // Anti-criterion (AUT-1052): no global (cross-tenant) lock on append.
  it('allows two tenants to append domain events concurrently without blocking', async () => {
    const other = await createTestTenant(basePrisma, 'domain-event-concurrent');
    const otherSiteId = await resolveTestMainSiteId(basePrisma, other.tenantId);
    const otherPrisma = createTenantAwarePrisma(basePrisma, other.tenantId);
    const domainEventStore = app.get(DomainEventStoreService);

    const txAInserted = createDeferred<void>();
    const releaseTxA = createDeferred<void>();
    let txAPromise: Promise<unknown> | null = null;

    try {
      txAPromise = prisma.$transaction(
        async (tx) => {
          const appended = await domainEventStore.appendInTx(tx, {
            tenantId,
            siteId,
            entityId: randomUUID(),
            eventType: DOMAIN_EVENT_TYPES.workshopOrderScheduledV1,
            occurrenceKey: `test-concurrent-t1-${randomUUID()}`,
            occurredAt: new Date('2026-11-25T10:00:00.000Z'),
            traceId: randomUUID(),
            payload: {},
          });
          txAInserted.resolve();
          await releaseTxA.promise;
          return appended;
        },
        { timeout: 20_000 },
      );
      txAPromise.catch(txAInserted.reject);

      await txAInserted.promise;

      const otherAppended = await otherPrisma.$transaction(async (tx) =>
        domainEventStore.appendInTx(tx, {
          tenantId: other.tenantId,
          siteId: otherSiteId,
          entityId: randomUUID(),
          eventType: DOMAIN_EVENT_TYPES.workshopOrderScheduledV1,
          occurrenceKey: `test-concurrent-t2-${randomUUID()}`,
          occurredAt: new Date('2026-11-25T10:00:01.000Z'),
          traceId: randomUUID(),
          payload: {},
        }),
      );
      expect(otherAppended).not.toBeNull();
    } finally {
      releaseTxA.resolve();
      if (txAPromise) {
        await txAPromise.catch(() => undefined);
      }
      await cleanupTestTenantGraph(basePrisma, other.tenantId);
    }
  });
});
