import { createE2eApp } from './helpers/e2e-suite.js';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { DOMAIN_EVENT_TYPES } from '../src/domain-event-store/domain-event.constants.js';
import { encodeDomainEventFeedCursor } from '../src/domain-event-store/domain-event.cursor.js';
import { DomainEventStoreService } from '../src/domain-event-store/domain-event-store.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

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
        first_name: 'Pilot',
        last_name: 'Customer',
        email: `domain-events-${Date.now()}@example.com`,
        type: 'PRIVATE',
      },
    });
    customerId = customer.id;
    const vehicle = await prisma.vehicle.create({
      data: {
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
});
