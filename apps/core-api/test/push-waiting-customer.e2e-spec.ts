import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { MechanicMediaStorage } from '../src/mechanic/mechanic-media.storage.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createE2eApp } from './helpers/e2e-suite.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestTenant,
  resolveTestMainSiteId,
  seedTestEmployee,
  seedTestTenantMember,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

/** AUT-766 / ADR-0033: a task that goes to WAITING_CUSTOMER writes PUSH rows for the advisors of the site who opted in. */
describe('Push for WAITING_CUSTOMER (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let tenantId: string;
  let mechanicToken: string;
  let orderId: string;
  let optedInAdvisorUserId: string;
  const taskIds: string[] = [];

  const api = () => request(app.getHttpServer());
  const db = () => createTenantAwarePrisma(basePrisma, tenantId);
  const pushRows = () =>
    db().notificationOutbox.findMany({
      where: { workshop_order_id: orderId, channel: 'PUSH' },
      select: {
        recipient_user_id: true,
        event_type: true,
        status: true,
        idempotency_key: true,
      },
    });

  async function createUser(label: string, role: 'TECH' | 'SALES') {
    const user = await basePrisma.user.create({
      data: {
        firebaseUid: `e2e-push-wc-${label}-${randomUUID()}`,
        email: `push-wc-${label}-${randomUUID()}@example.com`,
      },
    });
    await seedTestTenantMember(basePrisma, { tenantId, userId: user.id, role });
    return user;
  }

  async function addAdvisor(
    label: string,
    optedIn: boolean,
    siteId: string | null,
  ) {
    const user = await createUser(label, 'SALES');
    if (siteId) {
      await db().siteMembership.create({
        data: {
          tenant_id: tenantId,
          user_id: user.id,
          site_id: siteId,
          is_active: true,
        },
      });
    }
    await seedTestEmployee(db(), {
      tenantId,
      name: `Push WC ${label}`,
      role: 'SERVICE_ADVISOR',
      userId: user.id,
    });
    if (optedIn) {
      await db().pushPreference.create({
        data: {
          tenant_id: tenantId,
          user_id: user.id,
          enabled_events: ['WORKSHOP_TASK_WAITING_CUSTOMER'],
        },
      });
    }
    return user.id;
  }

  beforeAll(async () => {
    process.env.WORKSHOP_MEDIA_BUCKET = 'test-workshop-media-bucket';
    app = await createE2eApp((builder) =>
      builder.overrideProvider(MechanicMediaStorage).useValue({
        createPresignedUpload: jest.fn(),
        ensureBucketExists: jest.fn(),
      }),
    );
    basePrisma = app.get(PrismaService);
    tenantId = (await createTestTenant(basePrisma, 'push-wc')).tenantId;
    const siteId = await resolveTestMainSiteId(basePrisma, tenantId);

    const mechanicUser = await createUser('mechanic', 'TECH');
    mechanicToken = app.get(AuthService).createTestToken({
      sub: mechanicUser.firebaseUid as string,
      email: mechanicUser.email,
      tenantId,
      role: 'TECH',
    });
    const mechanic = await seedTestEmployee(db(), {
      tenantId,
      name: 'Push WC Mechanic',
      role: 'MECHANIC',
      userId: mechanicUser.id,
    });

    optedInAdvisorUserId = await addAdvisor('opted-in', true, siteId);
    await addAdvisor('not-opted-in', false, siteId);
    await addAdvisor('other-site', true, null);

    const customer = await db().customer.create({
      data: {
        tenant_id: tenantId,
        first_name: 'E2E',
        last_name: 'PushCustomer',
        email: `push-wc-${randomUUID()}@example.com`,
        type: 'PRIVATE',
      },
    });
    const vehicle = await db().vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'Audi',
        model: 'A4',
        year: 2021,
        vin: `VIN-PUSH-WC-${randomUUID()}`,
        customer_id: customer.id,
      },
    });
    const order = await db().workshopOrder.create({
      data: {
        tenant_id: tenantId,
        site_id: siteId,
        order_number: `WO-PUSH-WC-${Date.now()}`,
        customer_id: customer.id,
        vehicle_id: vehicle.id,
        mechanic_id: mechanic.id,
        odometer: 90000,
        fuel_level: 50,
        status: 'INTAKE',
      },
    });
    orderId = order.id;
    for (const [index, title] of ['Oil change', 'Brake inspection'].entries()) {
      const task = await db().workshopTask.create({
        data: {
          tenant_id: tenantId,
          workshop_order_id: orderId,
          title,
          sequence: index + 1,
          status: 'NOT_STARTED',
        },
      });
      taskIds.push(task.id);
    }
  });

  afterAll(async () => {
    if (tenantId) {
      await db().notificationOutbox.deleteMany({});
      await db().pushPreference.deleteMany({});
      await cleanupTestTenantGraph(basePrisma, tenantId);
    }
    await teardownTestApp(app, basePrisma);
  });

  it('writes a PENDING push row only for the advisor of the site who opted in, keyed by the closed labor entry', async () => {
    await api()
      .post(`/api/mechanic/tasks/${taskIds[0]}/start`)
      .set({ Authorization: `Bearer ${mechanicToken}` })
      .expect(200);
    await api()
      .post(`/api/mechanic/tasks/${taskIds[0]}/pause`)
      .set({ Authorization: `Bearer ${mechanicToken}` })
      .send({ pauseReason: 'WAITING_CUSTOMER' })
      .expect(200);

    const entry = await db().laborEntry.findFirstOrThrow({
      where: { tenant_id: tenantId, workshop_task_id: taskIds[0] },
      select: { id: true },
    });
    const rows = await pushRows();
    expect(rows).toEqual([
      {
        recipient_user_id: optedInAdvisorUserId,
        event_type: 'WORKSHOP_TASK_WAITING_CUSTOMER',
        status: 'PENDING',
        idempotency_key: `WORKSHOP_TASK_WAITING_CUSTOMER:${entry.id}:user:${optedInAdvisorUserId}:PUSH`,
      },
    ]);
  });

  it('a pause for another reason writes no push row', async () => {
    await api()
      .post(`/api/mechanic/tasks/${taskIds[1]}/start`)
      .set({ Authorization: `Bearer ${mechanicToken}` })
      .expect(200);
    await api()
      .post(`/api/mechanic/tasks/${taskIds[1]}/pause`)
      .set({ Authorization: `Bearer ${mechanicToken}` })
      .send({ pauseReason: 'OTHER' })
      .expect(200);

    expect(await pushRows()).toHaveLength(1);
  });
});
