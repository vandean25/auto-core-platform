import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PdfStorage } from '../src/common/pdf/pdf-storage.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { WorkshopEstimatePdfRenderer } from '../src/workshop/workshop-estimate-pdf.renderer.js';
import { seedReadySellerAndAccountingProfile } from './invoice-snapshot-v2-test-utils.js';
import { createInMemoryPdfArchive } from './support/in-memory-pdf-archive.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

const SEND_FLAG = 'CUSTOMER_ESTIMATE_SEND_ENABLED';
const APPROVAL_BASE = 'https://portal.example.at';
const LINK_TOKEN = /\/approve\/([A-Za-z0-9_-]{43})/;
const APPROVE = {
  decision: 'APPROVE',
  typed_full_name: 'Anna Beispiel',
  legal_blocks_accepted: true,
  b2c_declaration_accepted: true,
};

/**
 * AUT-356 phase 6: the communication timeline of an order (runbook §2d). The estimate email and the customer's decision
 * are listed newest first. The worker never runs in this suite, so the queued email stays PENDING and reads as QUEUED.
 */
describe('Workshop order communications (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let adminToken: string;
  let customerId: string;
  let customerEmail: string;
  let otherTenantId: string | undefined;
  let previousSendFlag: string | undefined;
  let previousApprovalBaseUrl: string | undefined;

  const api = () => request(app.getHttpServer());
  const adminAuth = () => ({ Authorization: `Bearer ${adminToken}` });

  /** The role is read from the tenant membership, not from the token, so a test changes the membership itself. */
  async function setTenantMemberRole(role: 'ADMIN' | 'TECH') {
    await prisma.tenantMember.updateMany({
      where: { tenant_id: tenantId },
      data: { role },
    });
  }

  async function createOrderWithLabor(qty = 2, unitPrice = 80) {
    const vehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'Skoda',
        model: 'Octavia',
        year: 2019,
        vin: `VIN-TL-${randomUUID()}`,
        customer_id: customerId,
      },
    });
    const order = await api()
      .post('/api/workshop/orders')
      .set(adminAuth())
      .send({
        customerId,
        vehicleId: vehicle.id,
        odometer: 120000,
        fuelLevel: 40,
        notes: 'Ölwechsel',
      })
      .expect(201);
    const orderId = order.body.id as string;
    const task = await api()
      .post(`/api/workshop/orders/${orderId}/tasks`)
      .set(adminAuth())
      .send({ title: 'Ölwechsel' })
      .expect(201);
    await api()
      .patch(
        `/api/workshop/orders/${orderId}/tasks/${task.body.id as string}/line-items`,
      )
      .set(adminAuth())
      .send({
        expectedLineItemsVersion: 0,
        items: [
          {
            type: 'LABOR',
            itemNo: 'LAB-OIL',
            description: 'Ölwechsel',
            qty,
            unitPrice,
          },
        ],
      })
      .expect(200);
    return orderId;
  }

  /** Creates the estimate, sends it with the customer email, and reads the approval link out of the queued mail. */
  async function estimateSentByEmail() {
    const orderId = await createOrderWithLabor();
    const created = await api()
      .post(`/api/workshop/orders/${orderId}/estimates`)
      .set(adminAuth())
      .expect(201);
    const versionId = created.body.versions[0].id as string;
    await api()
      .post(`/api/workshop/estimates/${versionId}/send`)
      .set(adminAuth())
      .send({ notifyCustomerByEmail: true })
      .expect(200);
    const row = await prisma.notificationOutbox.findFirstOrThrow({
      where: { source_entity_id: versionId },
      select: { body: true },
    });
    const rawToken = LINK_TOKEN.exec(row.body ?? '')?.[1];
    if (!rawToken) {
      throw new Error('the queued email carries no approval link');
    }
    return { orderId, rawToken };
  }

  function timeline(orderId: string) {
    return api()
      .get(`/api/workshop/orders/${orderId}/communications`)
      .set(adminAuth())
      .expect(200);
  }

  beforeAll(async () => {
    previousSendFlag = process.env[SEND_FLAG];
    previousApprovalBaseUrl = process.env.ESTIMATE_APPROVAL_BASE_URL;
    process.env.ESTIMATE_APPROVAL_BASE_URL = APPROVAL_BASE;
    process.env[SEND_FLAG] = 'true';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PdfStorage)
      .useValue(createInMemoryPdfArchive('e2e-order-communications-archive'))
      .overrideProvider(WorkshopEstimatePdfRenderer)
      .useValue({
        render: async () => Buffer.from('%PDF-1.4 order communications stub'),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    basePrisma = app.get<PrismaService>(PrismaService);
    const testTenant = await createTestTenant(basePrisma);
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    adminToken = createTestAuthToken(app.get(AuthService), testTenant);
    await seedReadySellerAndAccountingProfile(prisma, tenantId);

    customerEmail = `timeline-${Date.now()}@example.com`;
    const customer = await prisma.customer.create({
      data: {
        tenant_id: tenantId,
        first_name: 'Anna',
        last_name: 'Beispiel',
        email: customerEmail,
        type: 'PRIVATE',
        address_street: 'Hauptstraße 2',
        address_zip: '8010',
        address_city: 'Graz',
        address_country: 'AT',
        contact_email_ok: true,
      },
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    if (previousSendFlag === undefined) {
      delete process.env[SEND_FLAG];
    } else {
      process.env[SEND_FLAG] = previousSendFlag;
    }
    if (previousApprovalBaseUrl === undefined) {
      delete process.env.ESTIMATE_APPROVAL_BASE_URL;
    } else {
      process.env.ESTIMATE_APPROVAL_BASE_URL = previousApprovalBaseUrl;
    }

    await prisma.workshopEstimateBrandAssetReference.deleteMany();
    // Evidence and estimate email rows reference the versions and orders (RESTRICT), so they go first.
    await prisma.workshopEstimateApproval.deleteMany();
    await prisma.notificationOutbox.deleteMany();
    await prisma.workshopEstimateApprovalToken.deleteMany();
    await prisma.workshopEstimateVersion.deleteMany();
    await prisma.workshopEstimate.deleteMany();
    await prisma.workshopEstimateSequence.deleteMany();
    await prisma.workshopTaskLineItem.deleteMany();
    await prisma.workshopTask.deleteMany();
    await prisma.workshopOrder.deleteMany();
    await prisma.vehicle.deleteMany();
    await prisma.customer.deleteMany();
    if (otherTenantId) {
      const other = createTenantAwarePrisma(basePrisma, otherTenantId);
      await other.workshopOrder.deleteMany();
      await other.vehicle.deleteMany();
      await other.customer.deleteMany();
      await cleanupTestTenantGraph(basePrisma, otherTenantId);
    }
    await teardownTestApp(app, basePrisma);
  });

  it('lists the queued estimate email, then the customer decision above it, with no address, body or typed name', async () => {
    const { orderId, rawToken } = await estimateSentByEmail();

    const queued = await timeline(orderId);
    expect(queued.body.data).toEqual([
      {
        id: expect.any(String),
        kind: 'ESTIMATE_EMAIL',
        channel: 'EMAIL',
        version: 1,
        occurred_at: expect.any(String),
        status: 'QUEUED',
        decision: null,
      },
    ]);

    await api()
      .post(`/api/public/estimate-approvals/${rawToken}`)
      .send(APPROVE)
      .expect(200);

    const decided = await timeline(orderId);
    expect(decided.body.data).toEqual([
      {
        id: expect.any(String),
        kind: 'ESTIMATE_APPROVAL',
        channel: 'LINK',
        version: 1,
        occurred_at: expect.any(String),
        status: null,
        decision: 'APPROVED',
      },
      expect.objectContaining({
        kind: 'ESTIMATE_EMAIL',
        status: 'QUEUED',
      }),
    ]);
    const text = JSON.stringify(decided.body);
    expect(text).not.toContain(customerEmail);
    expect(text).not.toContain('Anna Beispiel');
    expect(text).not.toContain(rawToken);
  });

  it('leaves out the internal notices of the order, and any row that differs from an estimate email in one field', async () => {
    const { orderId } = await estimateSentByEmail();
    const estimateEmail = await prisma.notificationOutbox.findFirstOrThrow({
      where: { workshop_order_id: orderId },
      select: { id: true },
    });
    // Each row matches the timeline's filter in every field but one, so dropping that one filter would list the row.
    const addRow = (
      overrides: Partial<Prisma.NotificationOutboxUncheckedCreateInput>,
    ) =>
      prisma.notificationOutbox.create({
        data: {
          tenant_id: tenantId,
          workshop_order_id: orderId,
          idempotency_key: randomUUID(),
          event_type: 'CUSTOMER_ESTIMATE_SENT',
          channel: 'EMAIL',
          recipient_kind: 'CUSTOMER',
          source_entity_type: 'WorkshopEstimateVersion',
          source_entity_id: randomUUID(),
          ...overrides,
        },
      });
    // The advisor's internal notice for a task that waits for the customer: in-app, and never sent to the customer.
    await addRow({
      event_type: 'WORKSHOP_TASK_WAITING_CUSTOMER',
      channel: 'IN_APP',
      recipient_kind: 'INTERNAL_TEAM',
      source_entity_type: 'WorkshopTask',
    });
    await addRow({ event_type: 'WORKSHOP_TASK_WAITING_CUSTOMER' });
    await addRow({ channel: 'IN_APP' });
    await addRow({ recipient_kind: 'INTERNAL_TEAM' });
    await addRow({ source_entity_type: 'WorkshopTask' });

    const response = await timeline(orderId);

    expect(response.body.data).toEqual([
      expect.objectContaining({
        id: estimateEmail.id,
        kind: 'ESTIMATE_EMAIL',
        version: 1,
      }),
    ]);
  });

  it('answers an order with no estimate yet with an empty timeline', async () => {
    const orderId = await createOrderWithLabor();

    const response = await timeline(orderId);

    expect(response.body).toEqual({ data: [] });
  });

  it('answers 404 for an order that does not exist', async () => {
    await api()
      .get(`/api/workshop/orders/${randomUUID()}/communications`)
      .set(adminAuth())
      .expect(404);
  });

  it('answers 404 for an order of another tenant, even with this tenant’s admin session', async () => {
    const other = await createTestTenant(basePrisma);
    otherTenantId = other.tenantId;
    const otherPrisma = createTenantAwarePrisma(basePrisma, other.tenantId);
    // Each tenant numbers its orders from 1, and the order-number index is global in the database (see the PR body).
    // Start this tenant's counter high, so its first number cannot collide with the first tenant's.
    await otherPrisma.financeSettings.upsert({
      where: { tenant_id: other.tenantId },
      update: { next_workshop_order_number: 900000 },
      create: {
        tenant_id: other.tenantId,
        fiscal_year_start_month: 1,
        lock_date: null,
        next_invoice_number: 1001,
        invoice_prefix: 'RE-2026-',
        next_sales_order_number: 1001,
        sales_order_prefix: 'SO-2026-',
        next_workshop_order_number: 900000,
        workshop_order_prefix: `WO-${new Date().getFullYear()}-`,
      },
    });
    const otherToken = createTestAuthToken(app.get(AuthService), other);
    const otherCustomer = await otherPrisma.customer.create({
      data: {
        tenant_id: other.tenantId,
        first_name: 'Bernd',
        last_name: 'Fremd',
        email: `fremd-${Date.now()}@example.com`,
        type: 'PRIVATE',
        address_street: 'Ringstraße 1',
        address_zip: '1010',
        address_city: 'Wien',
        address_country: 'AT',
        contact_email_ok: true,
      },
    });
    const otherVehicle = await otherPrisma.vehicle.create({
      data: {
        tenant_id: other.tenantId,
        make: 'Ford',
        model: 'Focus',
        year: 2018,
        vin: `VIN-FREMD-${randomUUID()}`,
        customer_id: otherCustomer.id,
      },
    });
    const foreign = await api()
      .post('/api/workshop/orders')
      .set({ Authorization: `Bearer ${otherToken}` })
      .send({
        customerId: otherCustomer.id,
        vehicleId: otherVehicle.id,
        odometer: 50000,
        fuelLevel: 30,
        notes: 'Fremder Auftrag',
      })
      .expect(201);

    // The order is there for its own tenant, so the 404 below is about the tenant and not a broken fixture.
    await api()
      .get(`/api/workshop/orders/${foreign.body.id as string}/communications`)
      .set({ Authorization: `Bearer ${otherToken}` })
      .expect(200);

    await api()
      .get(`/api/workshop/orders/${foreign.body.id as string}/communications`)
      .set(adminAuth())
      .expect(404);
  });

  it('refuses a technician session, and keeps the timeline to the estimate roles', async () => {
    const orderId = await createOrderWithLabor();

    await setTenantMemberRole('TECH');
    try {
      await api()
        .get(`/api/workshop/orders/${orderId}/communications`)
        .set(adminAuth())
        .expect(403);
    } finally {
      await setTenantMemberRole('ADMIN');
    }
  });
});
