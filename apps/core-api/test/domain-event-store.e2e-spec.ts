import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { DOMAIN_EVENT_TYPES } from '../src/domain-event-store/domain-event.constants.js';
import { encodeDomainEventFeedCursor } from '../src/domain-event-store/domain-event.cursor.js';
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
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

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
    });
    expect(JSON.stringify(events[0])).not.toMatch(/approve\//i);
  });

  it('rolls back the order when a domain event insert fails', async () => {
    const orderId = '00000000-0000-4000-8000-00000000dead';
    const occurrenceKey = `workshop_order.scheduled.v1:${orderId}`;
    await prisma.domainEvent.create({
      data: {
        id: '00000000-0000-4000-8000-00000000beef',
        event_type: DOMAIN_EVENT_TYPES.workshopOrderScheduledV1,
        schema_version: 1,
        tenant_id: tenantId,
        site_id: siteId,
        entity_id: orderId,
        occurred_at: new Date('2026-09-02T08:00:00.000Z'),
        trace_id: '00000000-0000-4000-8000-000000000010',
        occurrence_key: occurrenceKey,
      },
    });

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.workshopOrder.create({
          data: {
            id: orderId,
            tenant_id: tenantId,
            site_id: siteId,
            order_number: `WO-ROLLBACK-${Date.now()}`,
            purpose: 'CUSTOMER_REPAIR',
            customer_id: customerId,
            vehicle_id: vehicleId,
            status: 'SCHEDULED',
            bay_id: bayId,
            scheduled_start_at: new Date('2026-09-02T08:00:00.000Z'),
            scheduled_end_at: new Date('2026-09-02T09:00:00.000Z'),
            odometer: 0,
            fuel_level: 0,
          },
        });
        await tx.domainEvent.create({
          data: {
            event_type: DOMAIN_EVENT_TYPES.workshopOrderScheduledV1,
            schema_version: 1,
            tenant_id: tenantId,
            site_id: siteId,
            entity_id: orderId,
            occurred_at: new Date('2026-09-02T08:00:00.000Z'),
            trace_id: '00000000-0000-4000-8000-000000000011',
            occurrence_key: occurrenceKey,
          },
        });
      }),
    ).rejects.toThrow();

    const order = await prisma.workshopOrder.findFirst({
      where: { id: orderId, tenant_id: tenantId },
    });
    expect(order).toBeNull();
  });

  it('pages the feed by monotonic sequence with a versioned cursor', async () => {
    const first = await request(app.getHttpServer())
      .get('/api/agent/domain-events')
      .query({ pageSize: 1 })
      .set(auth())
      .expect(200);

    expect(first.body.data).toHaveLength(1);
    expect(first.body.data[0].sequence).toBeDefined();
    const cursor = first.body.meta.next_cursor as string;
    expect(cursor).toBeTruthy();

    const second = await request(app.getHttpServer())
      .get('/api/agent/domain-events')
      .query({ pageSize: 1, cursor })
      .set(auth())
      .expect(200);

    expect(second.body.data[0].sequence).not.toBe(first.body.data[0].sequence);
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
