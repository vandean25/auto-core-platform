import { INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import { AuthService } from '../src/auth/auth.service.js';
import {
  DASHBOARD_ENTITY_UPDATED_EVENT,
  type DashboardEntityUpdatedPayload,
} from '../src/dashboard-realtime/dashboard-events.types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createE2eApp, createE2eTenant } from './helpers/e2e-suite.js';
import {
  cleanupTestTenantGraph,
  runWithTenantContext,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

async function connectRealtimeSocket(
  baseUrl: string,
  token?: string,
): Promise<Socket> {
  const socket = io(`${baseUrl}/dashboard-realtime`, {
    path: '/api/socket.io',
    transports: ['websocket'],
    reconnection: false,
    ...(token !== undefined ? { auth: { token } } : {}),
  });

  await new Promise<void>((resolve, reject) => {
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
    };
    socket.on('connect', onConnect);
    socket.on('connect_error', onError);
  });

  return socket;
}

function waitForMatchingEvent(
  socket: Socket,
  predicate: (payload: DashboardEntityUpdatedPayload) => boolean,
): Promise<DashboardEntityUpdatedPayload> {
  return new Promise((resolve) => {
    const handler = (payload: DashboardEntityUpdatedPayload) => {
      if (predicate(payload)) {
        socket.off(DASHBOARD_ENTITY_UPDATED_EVENT, handler);
        resolve(payload);
      }
    };
    socket.on(DASHBOARD_ENTITY_UPDATED_EVENT, handler);
  });
}

describe('Dashboard realtime authenticated socket (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let prisma: PrismaService;
  let tenantA: Awaited<ReturnType<typeof createE2eTenant>>;
  let tenantB: Awaited<ReturnType<typeof createE2eTenant>>;
  const openSockets: Socket[] = [];

  beforeAll(async () => {
    app = await createE2eApp();
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');

    prisma = app.get(PrismaService);
    app.get(AuthService);

    tenantA = await createE2eTenant(app, prisma, 'rt-socket-a');
    tenantB = await createE2eTenant(app, prisma, 'rt-socket-b');
  });

  afterEach(() => {
    while (openSockets.length > 0) {
      openSockets.pop()?.disconnect();
    }
  });

  afterAll(async () => {
    if (tenantA) {
      await cleanupTestTenantGraph(prisma, tenantA.tenantId);
    }
    if (tenantB) {
      await cleanupTestTenantGraph(prisma, tenantB.tenantId);
    }
    if (app) {
      await teardownTestApp(app, prisma);
    }
  });

  it('rejects unauthenticated or invalid JWT handshakes', async () => {
    await expect(connectRealtimeSocket(baseUrl)).rejects.toThrow(
      'Unauthorized',
    );
    await expect(
      connectRealtimeSocket(baseUrl, 'not-a-valid-jwt'),
    ).rejects.toThrow('Unauthorized');
  });

  it('emits to the tenant room only after commit when data is readable, and isolates other tenants', async () => {
    const socketA = await connectRealtimeSocket(baseUrl, tenantA.authToken);
    const socketB = await connectRealtimeSocket(baseUrl, tenantB.authToken);
    openSockets.push(socketA, socketB);

    const receivedA: DashboardEntityUpdatedPayload[] = [];
    const receivedB: DashboardEntityUpdatedPayload[] = [];
    socketA.on(DASHBOARD_ENTITY_UPDATED_EVENT, (payload) => {
      receivedA.push(payload);
    });
    socketB.on(DASHBOARD_ENTITY_UPDATED_EVENT, (payload) => {
      receivedB.push(payload);
    });

    const eventOnAPromise = waitForMatchingEvent(
      socketA,
      (payload) => payload.type === 'CUSTOMER' && payload.action === 'CREATED',
    ).then(async (payload) => {
      const committedRow = await tenantA.prisma.customer.findFirst({
        where: { id: payload.entityId, tenant_id: tenantA.tenantId },
      });
      return { payload, committedRow };
    });

    const createdCustomer = await runWithTenantContext(tenantA.tenantId, () =>
      prisma.$transaction(async (tx) => {
        const customer = await tx.customer.create({
          data: {
            tenant_id: tenantA.tenantId,
            type: 'PRIVATE',
            first_name: 'Committed',
            last_name: 'Realtime',
            email: `rt-commit-${Date.now()}@example.com`,
          },
        });

        // Before the transaction commits, no realtime event has been emitted.
        expect(receivedA).toEqual([]);
        return customer;
      }),
    );

    const { payload, committedRow } = await eventOnAPromise;
    expect(payload).toEqual(
      expect.objectContaining({
        type: 'CUSTOMER',
        action: 'CREATED',
        entityId: createdCustomer.id,
      }),
    );
    expect(committedRow?.id).toBe(createdCustomer.id);

    // Trigger a committed write on tenant B and wait for its own event as a
    // deterministic barrier proving tenant A's event never crossed into B's room.
    const eventOnBPromise = waitForMatchingEvent(
      socketB,
      (item) => item.type === 'CUSTOMER' && item.action === 'CREATED',
    );
    const tenantBCustomer = await runWithTenantContext(tenantB.tenantId, () =>
      tenantB.prisma.customer.create({
        data: {
          tenant_id: tenantB.tenantId,
          type: 'PRIVATE',
          first_name: 'Isolated',
          last_name: 'TenantB',
          email: `rt-tenantb-${Date.now()}@example.com`,
        },
      }),
    );
    const payloadB = await eventOnBPromise;
    expect(payloadB.entityId).toBe(tenantBCustomer.id);
    expect(receivedB.map((item) => item.entityId)).not.toContain(
      createdCustomer.id,
    );
  });

  it('drops buffered events when an interactive transaction rolls back', async () => {
    const socketA = await connectRealtimeSocket(baseUrl, tenantA.authToken);
    openSockets.push(socketA);

    const receivedA: DashboardEntityUpdatedPayload[] = [];
    socketA.on(DASHBOARD_ENTITY_UPDATED_EVENT, (payload) => {
      receivedA.push(payload);
    });

    let rolledBackCustomerId = '';
    await expect(
      runWithTenantContext(tenantA.tenantId, () =>
        prisma.$transaction(async (tx) => {
          const customer = await tx.customer.create({
            data: {
              tenant_id: tenantA.tenantId,
              type: 'PRIVATE',
              first_name: 'RolledBack',
              last_name: 'Realtime',
              email: `rt-rollback-${Date.now()}@example.com`,
            },
          });
          rolledBackCustomerId = customer.id;
          throw new Error('force rollback');
        }),
      ),
    ).rejects.toThrow('force rollback');

    // Commit a sentinel write so we wait on a real post-commit event rather than a sleep.
    const sentinelPromise = waitForMatchingEvent(
      socketA,
      (item) => item.type === 'CUSTOMER' && item.action === 'CREATED',
    );
    const sentinelCustomer = await runWithTenantContext(tenantA.tenantId, () =>
      tenantA.prisma.customer.create({
        data: {
          tenant_id: tenantA.tenantId,
          type: 'PRIVATE',
          first_name: 'Sentinel',
          last_name: 'Committed',
          email: `rt-sentinel-${Date.now()}@example.com`,
        },
      }),
    );
    const sentinelPayload = await sentinelPromise;

    expect(sentinelPayload.entityId).toBe(sentinelCustomer.id);
    expect(receivedA.map((item) => item.entityId)).toEqual([
      sentinelCustomer.id,
    ]);
    expect(receivedA.map((item) => item.entityId)).not.toContain(
      rolledBackCustomerId,
    );
  });
});
