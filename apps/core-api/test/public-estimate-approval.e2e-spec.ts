import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PdfStorage } from '../src/common/pdf/pdf-storage.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { WorkshopEstimatePdfRenderer } from '../src/workshop/workshop-estimate-pdf.renderer.js';
import { createInMemoryPdfArchive } from './support/in-memory-pdf-archive.js';
import {
  cleanupTestUsers,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
} from './tenant-test-utils.js';
import { seedReadySellerAndAccountingProfile } from './invoice-snapshot-v2-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';
import { DOMAIN_EVENT_TYPES } from '../src/domain-event-store/domain-event.constants.js';
import { WORKSHOP_ESTIMATE_DECIDED_INTERNAL_NOTICE_CONSUMER } from '../src/domain-event-consumer/domain-event-consumer.constants.js';
import { WorkshopEstimateDecidedConsumerService } from '../src/workshop/workshop-estimate-decided-consumer.service.js';
import { assertDomainEventHasNoToken } from './domain-event-assertions.js';

const SEND_FLAG = 'CUSTOMER_ESTIMATE_SEND_ENABLED';
const APPROVAL_BASE = 'https://portal.example.at';
const LINK_TOKEN = /\/approve\/([A-Za-z0-9_-]{43})/;

describe('Public estimate approval (e2e, ADR-0025 §7)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let adminToken: string;
  let customerId: string;
  let customerEmail: string;
  const createdUserIds: string[] = [];
  let previousSendFlag: string | undefined;
  let previousApprovalBaseUrl: string | undefined;

  const api = () => request(app.getHttpServer());
  const adminAuth = () => ({ Authorization: `Bearer ${adminToken}` });

  async function createOrderWithLabor(qty = 2, unitPrice = 80) {
    const vehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'Skoda',
        model: 'Octavia',
        year: 2019,
        vin: `VIN-PUB-${randomUUID()}`,
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

  async function sendWithEmail(versionId: string) {
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
    return rawToken;
  }

  async function estimateSentByEmail(qty = 2, unitPrice = 80) {
    const orderId = await createOrderWithLabor(qty, unitPrice);
    const created = await api()
      .post(`/api/workshop/orders/${orderId}/estimates`)
      .set(adminAuth())
      .expect(201);
    const versionId = created.body.versions[0].id as string;
    const rawToken = await sendWithEmail(versionId);
    return { orderId, versionId, rawToken };
  }

  function publicRead(rawToken: string) {
    return api().get(`/api/public/estimate-approvals/${rawToken}`);
  }

  function publicDecide(rawToken: string, body: Record<string, unknown>) {
    return api().post(`/api/public/estimate-approvals/${rawToken}`).send(body);
  }

  const APPROVE = {
    decision: 'APPROVE',
    typed_full_name: 'Anna Beispiel',
    legal_blocks_accepted: true,
    b2c_declaration_accepted: true,
  };

  beforeAll(async () => {
    previousSendFlag = process.env[SEND_FLAG];
    previousApprovalBaseUrl = process.env.ESTIMATE_APPROVAL_BASE_URL;
    process.env.ESTIMATE_APPROVAL_BASE_URL = APPROVAL_BASE;
    process.env[SEND_FLAG] = 'true';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PdfStorage)
      .useValue(createInMemoryPdfArchive('e2e-public-approval-archive'))
      .overrideProvider(WorkshopEstimatePdfRenderer)
      .useValue({
        render: async () => Buffer.from('%PDF-1.4 public approval stub'),
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
    prisma = createTenantAwarePrisma(prisma, tenantId);
    adminToken = createTestAuthToken(app.get(AuthService), testTenant);
    await seedReadySellerAndAccountingProfile(prisma, tenantId);

    customerEmail = `public-${Date.now()}@example.com`;
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
    await cleanupTestUsers(basePrisma, createdUserIds);
    await teardownTestApp(app, prisma);
  });

  it('shows a decidable estimate without any session, with no-store and noindex headers, and consumes nothing', async () => {
    const { versionId, rawToken } = await estimateSentByEmail();

    const first = await publicRead(rawToken).expect(200);
    const second = await publicRead(rawToken).expect(200);

    expect(first.body.document.estimate_number).toMatch(/^KV-/);
    expect(first.body.legal.paragraphs.length).toBeGreaterThan(0);
    expect(second.body.document.estimate_number).toBe(
      first.body.document.estimate_number,
    );
    expect(JSON.stringify(first.body)).not.toContain(customerEmail);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.headers['referrer-policy']).toBe('no-referrer');
    expect(first.headers['x-robots-tag']).toBe('noindex, nofollow');

    const token = await prisma.workshopEstimateApprovalToken.findFirstOrThrow({
      where: { workshop_estimate_version_id: versionId },
    });
    expect(token.consumed_at).toBeNull();
  });

  it('answers a malformed trace id with 400 and still sends the headers, because the headers middleware runs first', async () => {
    const { rawToken } = await estimateSentByEmail();

    const response = await publicRead(rawToken)
      .set('X-Trace-Id', 'not-a-uuid')
      .expect(400);

    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  it('answers not found for an unknown or malformed link, with the same headers', async () => {
    const unknown = await publicRead('B'.repeat(43)).expect(404);
    const malformed = await publicRead('short').expect(404);

    expect(unknown.body.code).toBe('ESTIMATE_APPROVAL_NOT_FOUND');
    expect(malformed.body.code).toBe('ESTIMATE_APPROVAL_NOT_FOUND');
    expect(unknown.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  it('refuses an approval without its confirmations and consumes nothing', async () => {
    const { versionId, rawToken } = await estimateSentByEmail();

    const refused = await publicDecide(rawToken, {
      ...APPROVE,
      legal_blocks_accepted: false,
    }).expect(422);

    expect(refused.body.code).toBe('ESTIMATE_APPROVAL_CONFIRMATION_INCOMPLETE');
    const version = await prisma.workshopEstimateVersion.findFirstOrThrow({
      where: { id: versionId },
      select: { status: true },
    });
    expect(version.status).toBe('SENT');
    expect(
      await prisma.workshopEstimateApproval.count({
        where: { workshop_estimate_version_id: versionId },
      }),
    ).toBe(0);
  });

  it('approves once: records the evidence, moves the version and answers gone afterwards', async () => {
    const { orderId, versionId, rawToken } = await estimateSentByEmail();

    const decided = await publicDecide(rawToken, APPROVE).expect(200);

    expect(decided.body.decision).toBe('APPROVED');
    expect(typeof decided.body.decided_at).toBe('string');

    const version = await prisma.workshopEstimateVersion.findFirstOrThrow({
      where: { id: versionId },
      select: { status: true, snapshot_sha256: true },
    });
    expect(version.status).toBe('APPROVED');

    const evidence = await prisma.workshopEstimateApproval.findFirstOrThrow({
      where: { workshop_estimate_version_id: versionId },
    });
    expect(evidence).toMatchObject({
      channel: 'LINK',
      decision: 'APPROVED',
      content_sha256: version.snapshot_sha256,
      recipient_email: customerEmail,
      typed_full_name: 'Anna Beispiel',
      legal_blocks_accepted: true,
      b2c_declaration_accepted: true,
    });
    expect(evidence.approval_token_id).not.toBeNull();

    const token = await prisma.workshopEstimateApprovalToken.findFirstOrThrow({
      where: { workshop_estimate_version_id: versionId },
    });
    expect(token.consumed_at).not.toBeNull();
    expect(token.token_sha256).not.toContain(rawToken);

    const domainEvent = await prisma.domainEvent.findFirstOrThrow({
      where: {
        tenant_id: tenantId,
        event_type: DOMAIN_EVENT_TYPES.workshopEstimateDecidedV1,
      },
    });
    expect(domainEvent.payload).toMatchObject({
      estimate_version_id: versionId,
      decision: 'APPROVED',
    });
    assertDomainEventHasNoToken(domainEvent, rawToken);

    await publicRead(rawToken).expect(410);
    const again = await publicDecide(rawToken, APPROVE).expect(410);
    expect(again.body.code).toBe('ESTIMATE_APPROVAL_UNAVAILABLE');
    expect(
      await prisma.workshopEstimateApproval.count({
        where: { workshop_estimate_version_id: versionId },
      }),
    ).toBe(1);

    const notices = await prisma.notificationOutbox.findMany({
      where: {
        tenant_id: tenantId,
        event_type: 'CUSTOMER_ESTIMATE_DECIDED',
        source_entity_id: versionId,
      },
    });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      channel: 'IN_APP',
      status: 'ACCEPTED',
    });
    expect(notices[0].idempotency_key).toContain(domainEvent.id);
    expect(notices[0].payload).toMatchObject({
      decision: 'APPROVED',
      estimate_version_id: versionId,
      needs_human_review: false,
    });

    const consumer = app.get(WorkshopEstimateDecidedConsumerService);
    await consumer.processTenantBatch(tenantId);
    expect(
      await prisma.notificationOutbox.count({
        where: {
          tenant_id: tenantId,
          event_type: 'CUSTOMER_ESTIMATE_DECIDED',
          source_entity_id: versionId,
        },
      }),
    ).toBe(1);

    await prisma.domainEventConsumerDelivery.deleteMany({
      where: {
        tenant_id: tenantId,
        consumer_key: WORKSHOP_ESTIMATE_DECIDED_INTERNAL_NOTICE_CONSUMER,
        domain_event_id: domainEvent.id,
      },
    });
    await prisma.domainEventConsumerProgress.updateMany({
      where: {
        tenant_id: tenantId,
        consumer_key: WORKSHOP_ESTIMATE_DECIDED_INTERNAL_NOTICE_CONSUMER,
      },
      data: { cursor_sequence: BigInt(0), cursor_event_id: null },
    });
    await consumer.processTenantBatch(tenantId);
    expect(
      await prisma.notificationOutbox.count({
        where: {
          tenant_id: tenantId,
          event_type: 'CUSTOMER_ESTIMATE_DECIDED',
          source_entity_id: versionId,
        },
      }),
    ).toBe(1);

    const triage = await api()
      .get('/api/agent-supervision/triage')
      .set(adminAuth())
      .expect(200);
    expect(triage.body.data).toContainEqual(
      expect.objectContaining({
        kind: 'CUSTOMER_DECISION',
        entity_id: notices[0].id,
        reason: 'CUSTOMER_ESTIMATE_APPROVED',
      }),
    );

    await prisma.workshopOrder.update({
      where: { id: orderId },
      data: { status: 'INVOICED' },
    });
    const triageAfterInvoice = await api()
      .get('/api/agent-supervision/triage')
      .set(adminAuth())
      .expect(200);
    expect(triageAfterInvoice.body.data).not.toContainEqual(
      expect.objectContaining({
        kind: 'CUSTOMER_DECISION',
        entity_id: notices[0].id,
      }),
    );
    void orderId;
  });

  it('declines without confirmations and records the decision', async () => {
    const { versionId, rawToken } = await estimateSentByEmail();

    const declined = await publicDecide(rawToken, {
      decision: 'DECLINE',
      legal_blocks_accepted: false,
      b2c_declaration_accepted: false,
    }).expect(200);

    expect(declined.body.decision).toBe('DECLINED');
    const version = await prisma.workshopEstimateVersion.findFirstOrThrow({
      where: { id: versionId },
      select: { status: true },
    });
    expect(version.status).toBe('DECLINED');
    const evidence = await prisma.workshopEstimateApproval.findFirstOrThrow({
      where: { workshop_estimate_version_id: versionId },
    });
    expect(evidence.decision).toBe('DECLINED');
    expect(evidence.typed_full_name).toBeNull();
  });

  it('answers gone and marks the version expired once its validity has passed', async () => {
    const { versionId, rawToken } = await estimateSentByEmail();
    await prisma.workshopEstimateVersion.update({
      where: { id: versionId },
      data: { valid_until: new Date('2020-01-01T00:00:00.000Z') },
    });
    await prisma.workshopEstimateApprovalToken.updateMany({
      where: { workshop_estimate_version_id: versionId },
      data: { expires_at: new Date('2020-01-01T00:00:00.000Z') },
    });

    const read = await publicRead(rawToken).expect(410);
    expect(read.body.code).toBe('ESTIMATE_APPROVAL_UNAVAILABLE');

    const version = await prisma.workshopEstimateVersion.findFirstOrThrow({
      where: { id: versionId },
      select: { status: true },
    });
    expect(version.status).toBe('EXPIRED');
    await publicDecide(rawToken, APPROVE).expect(410);
  });

  it('invalidates the link of a superseded version when a later version is sent', async () => {
    const { orderId, versionId, rawToken } = await estimateSentByEmail(1, 50);

    const revised = await api()
      .post(`/api/workshop/orders/${orderId}/estimates/revisions`)
      .set(adminAuth())
      .expect(201);
    await api()
      .post(`/api/workshop/estimates/${revised.body.id as string}/send`)
      .set(adminAuth())
      .send({})
      .expect(200);

    const read = await publicRead(rawToken).expect(410);
    expect(read.body.code).toBe('ESTIMATE_APPROVAL_UNAVAILABLE');
    const superseded = await prisma.workshopEstimateVersion.findFirstOrThrow({
      where: { id: versionId },
      select: { status: true },
    });
    expect(superseded.status).toBe('SUPERSEDED');
  });
});
