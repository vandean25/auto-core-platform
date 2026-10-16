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
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('Workshop order ready email (AUT-357 e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let adminToken: string;
  let techToken: string;
  let customerId: string;
  let otherTenantId: string | undefined;

  const api = () => request(app.getHttpServer());
  const adminAuth = () => ({ Authorization: `Bearer ${adminToken}` });
  const techAuth = () => ({ Authorization: `Bearer ${techToken}` });

  async function setTenantMemberRole(role: 'ADMIN' | 'TECH') {
    await prisma.tenantMember.updateMany({
      where: { tenant_id: tenantId },
      data: { role },
    });
  }

  async function createCompletedOrder() {
    const vehicle = await prisma.vehicle.create({
      data: {
        make: 'Skoda',
        model: 'Octavia',
        year: 2019,
        vin: `VIN-RDY-${randomUUID()}`,
        customer_id: customerId,
      },
    });
    const order = await api()
      .post('/api/workshop/orders')
      .set(adminAuth())
      .send({
        customerId,
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
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();
    basePrisma = app.get(PrismaService);
    const tenant = await createTestTenant(basePrisma);
    tenantId = tenant.tenantId;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    await seedReadySellerAndAccountingProfile(prisma, tenantId);
    adminToken = await createTestAuthToken(app.get(AuthService), tenantId);
    techToken = adminToken;
    const customer = await prisma.customer.create({
      data: {
        tenant_id: tenantId,
        type: 'PRIVATE',
        first_name: 'Max',
        last_name: 'Muster',
        email: 'ready@example.at',
        contact_email_ok: true,
      },
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    if (otherTenantId) {
      await cleanupTestTenantGraph(basePrisma, otherTenantId);
    }
    await cleanupTestTenantGraph(basePrisma, tenantId);
    await teardownTestApp(app);
  });

  it('queues one ready email on first transition to COMPLETED and exposes notice on the order', async () => {
    const orderId = await createCompletedOrder();
    const detail = await api()
      .get(`/api/workshop/orders/${orderId}`)
      .set(adminAuth())
      .expect(200);
    expect(detail.body.ready_email_notice?.code).toBe('QUEUED');

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
  });

  it('refuses resend for TECH with 403', async () => {
    const orderId = await createCompletedOrder();
    await setTenantMemberRole('TECH');
    await api()
      .post(`/api/workshop/orders/${orderId}/ready-email/resend`)
      .set(techAuth())
      .expect(403);
    await setTenantMemberRole('ADMIN');
  });

  it('isolates ready communications by tenant', async () => {
    const orderId = await createCompletedOrder();
    const other = await createTestTenant(basePrisma);
    otherTenantId = other.tenantId;
    const otherToken = await createTestAuthToken(
      app.get(AuthService),
      otherTenantId,
    );
    await api()
      .get(`/api/workshop/orders/${orderId}/communications`)
      .set({ Authorization: `Bearer ${otherToken}` })
      .expect(404);
  });
});
