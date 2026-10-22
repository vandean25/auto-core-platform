import { createHash, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PdfStorage } from '../src/common/pdf/pdf-storage.js';
import { NotificationCloudTasksService } from '../src/notifications/notification-cloud-tasks.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SiteService } from '../src/site/site.service.js';
import { WorkshopEstimatePdfRenderer } from '../src/workshop/workshop-estimate-pdf.renderer.js';
import { createInMemoryPdfArchive } from './support/in-memory-pdf-archive.js';
import {
  cleanupTestUsers,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
  seedTestTenantMember,
} from './tenant-test-utils.js';
import { seedReadySellerAndAccountingProfile } from './invoice-snapshot-v2-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

const SEND_FLAG = 'CUSTOMER_ESTIMATE_SEND_ENABLED';

describe('Workshop estimates (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let tenantEmail: string;
  let adminToken: string;
  let customerId: string;
  let mainSiteId: string;
  // Users created by this suite are cleaned up, so no tenant user is left with a null
  // active site for other suites' global updates to point at a foreign site.
  const createdUserIds: string[] = [];
  let previousSendFlag: string | undefined;
  let previousWriterFlag: string | undefined;
  let previousApprovalBaseUrl: string | undefined;

  const api = () => request(app.getHttpServer());
  const adminAuth = () => ({ Authorization: `Bearer ${adminToken}` });

  async function createOrderWithLabor(qty = 2, unitPrice = 80) {
    // One open order per vehicle: every order gets its own vehicle.
    const vehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'Skoda',
        model: 'Octavia',
        year: 2019,
        vin: `VIN-KV-${randomUUID()}`,
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
    return { orderId, taskId: task.body.id as string };
  }

  async function addSecondLaborLine(orderId: string) {
    const task = await api()
      .post(`/api/workshop/orders/${orderId}/tasks`)
      .set(adminAuth())
      .send({ title: 'Bremsflüssigkeit' })
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
            itemNo: 'LAB-BRF',
            description: 'Bremsflüssigkeit wechseln',
            qty: 1,
            unitPrice: 45,
          },
        ],
      })
      .expect(200);
  }

  async function createEstimate(orderId: string) {
    const res = await api()
      .post(`/api/workshop/orders/${orderId}/estimates`)
      .set(adminAuth());
    if (res.status !== 201) {
      throw new Error(
        `create estimate returned ${res.status}: ${JSON.stringify(res.body)}`,
      );
    }
    return res;
  }

  beforeAll(async () => {
    previousSendFlag = process.env[SEND_FLAG];
    previousWriterFlag = process.env.INVOICE_BRANDING_WRITER_ENABLED;
    // The boot check needs the approval base while the send flag is on, so both are set before the app compiles.
    previousApprovalBaseUrl = process.env.ESTIMATE_APPROVAL_BASE_URL;
    process.env.ESTIMATE_APPROVAL_BASE_URL = 'https://portal.example.at';
    process.env[SEND_FLAG] = 'true';

    // A send queues the estimate archive. Stub the render and the storage so this suite
    // stays off Chromium and GCS. The PDF pipeline has its own suite (workshop-estimate-pdf).
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PdfStorage)
      .useValue(createInMemoryPdfArchive('e2e-estimate-kv-archive'))
      .overrideProvider(WorkshopEstimatePdfRenderer)
      .useValue({
        render: async () => Buffer.from('%PDF-1.4 workshop estimate stub'),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    basePrisma = app.get<PrismaService>(PrismaService);
    prisma = basePrisma;
    const testTenant = await createTestTenant(prisma);
    tenantId = testTenant.tenantId;
    tenantEmail = testTenant.email;
    prisma = createTenantAwarePrisma(prisma, tenantId);
    adminToken = createTestAuthToken(app.get(AuthService), testTenant);
    await seedReadySellerAndAccountingProfile(prisma, tenantId);

    mainSiteId = (
      await prisma.site.findFirstOrThrow({
        where: { tenant_id: tenantId },
        select: { id: true },
      })
    ).id;

    const customer = await prisma.customer.create({
      data: {
        tenant_id: tenantId,
        first_name: 'Anna',
        last_name: 'Beispiel',
        email: `kv-${Date.now()}@example.com`,
        type: 'PRIVATE',
        address_street: 'Hauptstraße 2',
        address_zip: '8010',
        address_city: 'Graz',
        address_country: 'AT',
      },
    });
    customerId = customer.id;
  });

  beforeEach(() => {
    process.env[SEND_FLAG] = 'true';
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
    if (previousWriterFlag === undefined) {
      delete process.env.INVOICE_BRANDING_WRITER_ENABLED;
    } else {
      process.env.INVOICE_BRANDING_WRITER_ENABLED = previousWriterFlag;
    }

    await prisma.workshopEstimateBrandAssetReference.deleteMany();
    // Estimate email rows reference their order (ON DELETE RESTRICT), so they go before the orders do.
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
    await cleanupTestUsers(basePrisma, createdUserIds);
    await teardownTestApp(app, prisma);
  });

  it('creates KV-YYYY-XXXX as a version-1 draft that previews the live order lines', async () => {
    const { orderId } = await createOrderWithLabor(2, 80);

    const created = await createEstimate(orderId);

    expect(created.body.estimate_number).toMatch(/^KV-\d{4}-\d{4}$/);
    expect(created.body.versions).toEqual([
      expect.objectContaining({
        version: 1,
        status: 'DRAFT',
        snapshot_sha256: null,
      }),
    ]);
    expect(created.body.send_enabled).toBe(true);

    const versionId = created.body.versions[0].id as string;
    const version = await api()
      .get(`/api/workshop/estimates/${versionId}`)
      .set(adminAuth())
      .expect(200);
    expect(version.body.snapshot).toBeNull();
    expect(version.body.draft_preview.totals).toMatchObject({
      total_net: '160.00',
      total_tax: '32.00',
      total_gross: '192.00',
    });
  });

  it('keeps one estimate per order and refuses a revision while the draft is open', async () => {
    const { orderId } = await createOrderWithLabor();
    await createEstimate(orderId);

    const second = await api()
      .post(`/api/workshop/orders/${orderId}/estimates`)
      .set(adminAuth())
      .expect(409);
    expect(second.body.code).toBe('ESTIMATE_ALREADY_EXISTS');

    const revision = await api()
      .post(`/api/workshop/orders/${orderId}/estimates/revisions`)
      .set(adminAuth())
      .expect(409);
    expect(revision.body.code).toBe('ESTIMATE_DRAFT_OPEN');
  });

  it('refuses to send while customer sending is switched off (legal copy not approved)', async () => {
    process.env[SEND_FLAG] = 'false';
    const { orderId } = await createOrderWithLabor();
    const created = await createEstimate(orderId);

    const refused = await api()
      .post(
        `/api/workshop/estimates/${created.body.versions[0].id as string}/send`,
      )
      .set(adminAuth())
      .expect(503);

    expect(refused.body.code).toBe('ESTIMATE_SEND_DISABLED');
    const version = await api()
      .get(`/api/workshop/estimates/${created.body.versions[0].id as string}`)
      .set(adminAuth())
      .expect(200);
    expect(version.body.status).toBe('DRAFT');
  });

  it('freezes the snapshot at send and does not change it when the order is edited afterwards', async () => {
    const { orderId } = await createOrderWithLabor(2, 80);
    const created = await createEstimate(orderId);
    const versionId = created.body.versions[0].id as string;

    const sent = await api()
      .post(`/api/workshop/estimates/${versionId}/send`)
      .set(adminAuth())
      .expect(200);

    expect(sent.body).toMatchObject({
      status: 'SENT',
      version: 1,
      total_gross: '192.00',
      legal_text_version: 'kv-legal-de-v1',
    });
    expect(sent.body.snapshot_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(sent.body.snapshot.document).toMatchObject({
      title: 'Kostenvoranschlag',
      non_binding: true,
      validity_days: 14,
      price_display: 'GROSS',
    });
    const validUntil = new Date(sent.body.valid_until as string).getTime();
    const validFrom = new Date(sent.body.valid_from as string).getTime();
    expect(validUntil - validFrom).toBe(14 * 24 * 60 * 60 * 1000);

    await addSecondLaborLine(orderId);

    const after = await api()
      .get(`/api/workshop/estimates/${versionId}`)
      .set(adminAuth())
      .expect(200);
    expect(after.body.snapshot).toEqual(sent.body.snapshot);
    expect(after.body.snapshot_sha256).toBe(sent.body.snapshot_sha256);
    expect(after.body.snapshot.lines).toHaveLength(1);
    expect(after.body.total_gross).toBe('192.00');
  });

  async function setCustomerEmailConfirmation(contactEmailOk: boolean) {
    await api()
      .patch(`/api/customers/${customerId}`)
      .set(adminAuth())
      .send({ contact_email_ok: contactEmailOk })
      .expect(200);
  }

  it('refuses an emailed send until the advisor has confirmed the customer address, and queues nothing', async () => {
    await setCustomerEmailConfirmation(false);
    const { orderId } = await createOrderWithLabor(1, 50);
    const created = await createEstimate(orderId);
    const versionId = created.body.versions[0].id as string;

    const refused = await api()
      .post(`/api/workshop/estimates/${versionId}/send`)
      .set(adminAuth())
      .send({ notifyCustomerByEmail: true })
      .expect(422);

    expect(refused.body.code).toBe('ESTIMATE_CUSTOMER_EMAIL_NOT_CONFIRMED');
    expect(
      await prisma.workshopEstimateVersion.findFirstOrThrow({
        where: { id: versionId },
        select: { status: true },
      }),
    ).toEqual({ status: 'DRAFT' });
    expect(
      await prisma.workshopEstimateApprovalToken.count({
        where: { workshop_estimate_version_id: versionId },
      }),
    ).toBe(0);
    expect(
      await prisma.notificationOutbox.count({
        where: { source_entity_id: versionId },
      }),
    ).toBe(0);
  });

  it('queues the estimate email with the approval link, and keeps only the hash of its token', async () => {
    await setCustomerEmailConfirmation(true);
    const { orderId } = await createOrderWithLabor(2, 80);
    const created = await createEstimate(orderId);
    const versionId = created.body.versions[0].id as string;

    // The wake-up is spied, so the test sees whether the row was already committed when it was enqueued (ADR-0025 §6).
    let rowVisibleAtWakeUp: boolean | undefined;
    const wakeUp = jest
      .spyOn(app.get(NotificationCloudTasksService), 'enqueueWakeUp')
      .mockImplementation(async ({ outboxId }) => {
        rowVisibleAtWakeUp =
          (await prisma.notificationOutbox.findFirst({
            where: { id: outboxId },
          })) !== null;
      });
    const sent = await api()
      .post(`/api/workshop/estimates/${versionId}/send`)
      .set(adminAuth())
      .send({ notifyCustomerByEmail: true })
      .expect(200);
    expect(JSON.stringify(sent.body)).not.toContain('/approve/');
    expect(wakeUp).toHaveBeenCalledTimes(1);
    expect(rowVisibleAtWakeUp).toBe(true);

    const customer = await prisma.customer.findFirstOrThrow({
      where: { id: customerId },
      select: { email: true },
    });
    const row = await prisma.notificationOutbox.findFirstOrThrow({
      where: { source_entity_id: versionId },
    });
    expect(row).toMatchObject({
      event_type: 'CUSTOMER_ESTIMATE_SENT',
      channel: 'EMAIL',
      recipient_kind: 'CUSTOMER',
      recipient_email: customer.email,
    });
    expect(row.subject).toMatch(/^Kostenvoranschlag KV-/);
    expect(row.payload).toEqual({ customer_id: customerId });
    expect(wakeUp).toHaveBeenCalledWith({
      outboxId: row.id,
      tenantId: row.tenant_id,
    });
    wakeUp.mockRestore();

    const rawToken = /\/approve\/([A-Za-z0-9_-]{43})/.exec(row.body ?? '')?.[1];
    expect(rawToken).toBeDefined();
    const token = await prisma.workshopEstimateApprovalToken.findFirstOrThrow({
      where: { workshop_estimate_version_id: versionId },
    });
    expect(token.token_sha256).toBe(
      createHash('sha256')
        .update(rawToken as string, 'utf8')
        .digest('hex'),
    );
    expect(token.token_sha256).not.toBe(rawToken);
    expect(token.expires_at.toISOString()).toBe(sent.body.valid_until);
    expect(token.invalidated_at).toBeNull();
  });

  it('sends without an email when the advisor does not ask for one, and queues no token or message', async () => {
    const { orderId } = await createOrderWithLabor(1, 45);
    const created = await createEstimate(orderId);
    const versionId = created.body.versions[0].id as string;

    await api()
      .post(`/api/workshop/estimates/${versionId}/send`)
      .set(adminAuth())
      .expect(200);

    expect(
      await prisma.workshopEstimateApprovalToken.count({
        where: { workshop_estimate_version_id: versionId },
      }),
    ).toBe(0);
    expect(
      await prisma.notificationOutbox.count({
        where: { source_entity_id: versionId },
      }),
    ).toBe(0);
  });

  it('invalidates the approval link of a superseded version when a later version is sent', async () => {
    await setCustomerEmailConfirmation(true);
    const { orderId } = await createOrderWithLabor(1, 60);
    const created = await createEstimate(orderId);
    const firstVersionId = created.body.versions[0].id as string;
    await api()
      .post(`/api/workshop/estimates/${firstVersionId}/send`)
      .set(adminAuth())
      .send({ notifyCustomerByEmail: true })
      .expect(200);

    const revised = await api()
      .post(`/api/workshop/orders/${orderId}/estimates/revisions`)
      .set(adminAuth())
      .expect(201);
    // The revision answers with the new draft version itself.
    const draftId = revised.body.id as string;
    expect(revised.body.status).toBe('DRAFT');

    await api()
      .post(`/api/workshop/estimates/${draftId}/send`)
      .set(adminAuth())
      .send({ notifyCustomerByEmail: true })
      .expect(200);

    const first = await prisma.workshopEstimateApprovalToken.findFirstOrThrow({
      where: { workshop_estimate_version_id: firstVersionId },
    });
    const second = await prisma.workshopEstimateApprovalToken.findFirstOrThrow({
      where: { workshop_estimate_version_id: draftId },
    });
    expect(first.invalidated_at).not.toBeNull();
    expect(second.invalidated_at).toBeNull();
  });

  it('sends without the invoice branding writer flag and keeps every other gate unchanged', async () => {
    process.env.INVOICE_BRANDING_WRITER_ENABLED = 'false';
    const { orderId } = await createOrderWithLabor();
    const created = await createEstimate(orderId);

    await api()
      .post(
        `/api/workshop/estimates/${created.body.versions[0].id as string}/send`,
      )
      .set(adminAuth())
      .expect(200);
  });

  it('keeps old versions readable and supersedes the previously sent version on revision', async () => {
    const { orderId } = await createOrderWithLabor();
    const created = await createEstimate(orderId);
    const firstVersionId = created.body.versions[0].id as string;
    await api()
      .post(`/api/workshop/estimates/${firstVersionId}/send`)
      .set(adminAuth())
      .expect(200);

    const revision = await api()
      .post(`/api/workshop/orders/${orderId}/estimates/revisions`)
      .set(adminAuth())
      .expect(201);
    expect(revision.body).toMatchObject({
      version: 2,
      status: 'DRAFT',
      estimate_number: created.body.estimate_number,
    });
    const secondVersionId = revision.body.id as string;

    await api()
      .post(`/api/workshop/estimates/${secondVersionId}/send`)
      .set(adminAuth())
      .expect(200);

    const first = await api()
      .get(`/api/workshop/estimates/${firstVersionId}`)
      .set(adminAuth())
      .expect(200);
    expect(first.body).toMatchObject({ version: 1, status: 'SUPERSEDED' });
    expect(first.body.snapshot).not.toBeNull();

    const list = await api()
      .get(`/api/workshop/orders/${orderId}/estimates`)
      .set(adminAuth())
      .expect(200);
    expect(
      list.body.data[0].versions.map((v: { status: string }) => v.status),
    ).toEqual(['SUPERSEDED', 'SENT']);
  });

  it('refuses a TECH session on every estimate action', async () => {
    // The role is read from the tenant membership in Postgres, so the TECH session
    // is a real TECH membership on its own user (as in the mechanic e2e specs).
    const techFirebaseUid = `kv-tech-${randomUUID()}`;
    const techEmail = `${techFirebaseUid}@example.com`;
    const techUser = await basePrisma.user.create({
      data: { firebaseUid: techFirebaseUid, email: techEmail },
    });
    createdUserIds.push(techUser.id);
    await seedTestTenantMember(basePrisma, {
      tenantId,
      userId: techUser.id,
      role: 'TECH',
    });
    const techToken = app.get(AuthService).createTestToken({
      sub: techFirebaseUid,
      email: techEmail,
      tenantId,
      role: 'TECH',
    });

    const { orderId } = await createOrderWithLabor();
    const created = await createEstimate(orderId);
    const versionId = created.body.versions[0].id as string;
    const tech = { Authorization: `Bearer ${techToken}` };

    await api()
      .post(`/api/workshop/orders/${orderId}/estimates`)
      .set(tech)
      .expect(403);
    await api()
      .get(`/api/workshop/orders/${orderId}/estimates`)
      .set(tech)
      .expect(403);
    await api()
      .post(`/api/workshop/orders/${orderId}/estimates/revisions`)
      .set(tech)
      .expect(403);
    await api()
      .get(`/api/workshop/estimates/${versionId}`)
      .set(tech)
      .expect(403);
    await api()
      .post(`/api/workshop/estimates/${versionId}/send`)
      .set(tech)
      .expect(403);
  });

  it('does not expose or change another tenant estimate', async () => {
    const { orderId } = await createOrderWithLabor();
    const created = await createEstimate(orderId);
    const versionId = created.body.versions[0].id as string;
    const otherTenant = await createTestTenant(basePrisma);
    const other = {
      Authorization: `Bearer ${createTestAuthToken(app.get(AuthService), otherTenant)}`,
    };

    await api()
      .get(`/api/workshop/orders/${orderId}/estimates`)
      .set(other)
      .expect(404);
    await api()
      .get(`/api/workshop/estimates/${versionId}`)
      .set(other)
      .expect(404);
    await api()
      .post(`/api/workshop/orders/${orderId}/estimates`)
      .set(other)
      .expect(404);
    await api()
      .post(`/api/workshop/orders/${orderId}/estimates/revisions`)
      .set(other)
      .expect(404);
    await api()
      .post(`/api/workshop/estimates/${versionId}/send`)
      .set(other)
      .expect(404);

    const version = await api()
      .get(`/api/workshop/estimates/${versionId}`)
      .set(adminAuth())
      .expect(200);
    expect(version.body.status).toBe('DRAFT');
  });

  it('does not expose an estimate from another site of the same tenant', async () => {
    const { orderId } = await createOrderWithLabor();
    const created = await createEstimate(orderId);
    const versionId = created.body.versions[0].id as string;

    const second = await runWithTenantContext(tenantId, async () => {
      const legalEntity = await prisma.legalEntity.findFirstOrThrow({
        where: { tenant_id: tenantId },
        select: { id: true },
      });
      const user = await prisma.user.findFirstOrThrow({
        where: { email: tenantEmail },
        select: { id: true },
      });
      const siteService = app.get(SiteService);
      const site = await siteService.createSite({
        legalEntityId: legalEntity.id,
        code: 'KV-SECOND',
        name: 'Zweiter Standort',
      });
      await siteService.addSiteMembership(site.id, { userId: user.id });
      return site;
    });
    await api()
      .patch('/api/me/active-site')
      .set(adminAuth())
      .send({ siteId: second.id })
      .expect(200);

    try {
      await api()
        .get(`/api/workshop/orders/${orderId}/estimates`)
        .set(adminAuth())
        .expect(404);
      await api()
        .get(`/api/workshop/estimates/${versionId}`)
        .set(adminAuth())
        .expect(404);
      await api()
        .post(`/api/workshop/orders/${orderId}/estimates`)
        .set(adminAuth())
        .expect(404);
      await api()
        .post(`/api/workshop/orders/${orderId}/estimates/revisions`)
        .set(adminAuth())
        .expect(404);
      await api()
        .post(`/api/workshop/estimates/${versionId}/send`)
        .set(adminAuth())
        .expect(404);
    } finally {
      await api()
        .patch('/api/me/active-site')
        .set(adminAuth())
        .send({ siteId: mainSiteId })
        .expect(200);
    }
  });
});
