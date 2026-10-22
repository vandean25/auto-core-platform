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
  seedTestTenantMember,
} from './tenant-test-utils.js';
import { seedReadySellerAndAccountingProfile } from './invoice-snapshot-v2-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

const SEND_FLAG = 'CUSTOMER_ESTIMATE_SEND_ENABLED';

/** Advisor-recorded decisions, overrun tracking and "Resume waiting tasks" (AUT-355). */
describe('Workshop estimate approval capture (e2e, AUT-355)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let adminToken: string;
  let adminUserId: string;
  let adminFirebaseUid: string;
  let customerId: string;
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
        vin: `VIN-AP-${randomUUID()}`,
        customer_id: customerId,
      },
    });
    const order = await api()
      .post('/api/workshop/orders')
      .set(adminAuth())
      .send({
        customerId,
        vehicleId: vehicle.id,
        odometer: 90000,
        fuelLevel: 50,
        notes: 'Inspektion',
      })
      .expect(201);
    const orderId = order.body.id as string;
    const task = await api()
      .post(`/api/workshop/orders/${orderId}/tasks`)
      .set(adminAuth())
      .send({ title: 'Inspektion' })
      .expect(201);
    await addLaborLine(orderId, task.body.id as string, {
      itemNo: 'LAB-INSP',
      description: 'Inspektion',
      qty,
      unitPrice,
    });
    return { orderId, taskId: task.body.id as string };
  }

  async function addLaborLine(
    orderId: string,
    taskId: string,
    line: { itemNo: string; description: string; qty: number; unitPrice: number },
  ) {
    await api()
      .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}/line-items`)
      .set(adminAuth())
      .send({
        expectedLineItemsVersion: 0,
        items: [{ type: 'LABOR', ...line }],
      })
      .expect(200);
  }

  async function sentVersion(orderId: string) {
    const created = await api()
      .post(`/api/workshop/orders/${orderId}/estimates`)
      .set(adminAuth())
      .expect(201);
    const versionId = created.body.versions[0].id as string;
    await api()
      .post(`/api/workshop/estimates/${versionId}/send`)
      .set(adminAuth())
      .expect(200);
    return versionId;
  }

  function decide(versionId: string, body: Record<string, unknown>) {
    return api()
      .post(`/api/workshop/estimates/${versionId}/approve-advisor`)
      .set(adminAuth())
      .send(body);
  }

  const validDecision = {
    decision: 'APPROVED',
    channel: 'PHONE',
    amount_quoted_gross: '192.00',
    note: 'Telefonisch bestätigt, Kunde möchte Termin am Freitag.',
  };

  beforeAll(async () => {
    previousSendFlag = process.env[SEND_FLAG];
    previousApprovalBaseUrl = process.env.ESTIMATE_APPROVAL_BASE_URL;
    process.env.ESTIMATE_APPROVAL_BASE_URL = 'https://portal.example.at';
    process.env[SEND_FLAG] = 'true';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PdfStorage)
      .useValue(createInMemoryPdfArchive('e2e-estimate-approval-archive'))
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
    const testTenant = await createTestTenant(basePrisma);
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    adminFirebaseUid = testTenant.firebaseUid;
    adminToken = createTestAuthToken(app.get(AuthService), testTenant);
    const adminUser = await basePrisma.user.findFirstOrThrow({
      where: { firebaseUid: adminFirebaseUid },
      select: { id: true },
    });
    adminUserId = adminUser.id;
    await seedReadySellerAndAccountingProfile(prisma, tenantId);

    const customer = await prisma.customer.create({
      data: {
        tenant_id: tenantId,
        first_name: 'Erika',
        last_name: 'Musterfrau',
        email: `ap-${Date.now()}@example.com`,
        type: 'PRIVATE',
        address_street: 'Ringstraße 9',
        address_zip: '8020',
        address_city: 'Graz',
        address_country: 'AT',
      },
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    restoreEnv(SEND_FLAG, previousSendFlag);
    restoreEnv('ESTIMATE_APPROVAL_BASE_URL', previousApprovalBaseUrl);

    await prisma.notificationOutbox.deleteMany();
    await prisma.workshopEstimateOverrun.deleteMany();
    await prisma.workshopEstimateApproval.deleteMany();
    await prisma.workshopEstimateBrandAssetReference.deleteMany();
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

  it('records an advisor phone approval on the sent version, with evidence, audit and event, and no IP or user agent', async () => {
    const { orderId } = await createOrderWithLabor(2, 80);
    const versionId = await sentVersion(orderId);

    const res = await decide(versionId, validDecision).expect(201);

    expect(res.body.status).toBe('APPROVED');
    expect(res.body.approval).toMatchObject({
      channel: 'PHONE',
      decision: 'APPROVED',
      amount_quoted_gross: '192.00',
      note: validDecision.note,
      recorded_by_user_id: adminUserId,
    });
    const approval = await prisma.workshopEstimateApproval.findFirstOrThrow({
      where: { workshop_estimate_version_id: versionId },
    });
    expect(approval).toMatchObject({
      channel: 'PHONE',
      decision: 'APPROVED',
      ip_address: null,
      user_agent: null,
      approval_token_id: null,
      legal_blocks_accepted: false,
      b2c_declaration_accepted: false,
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entity_type: 'WorkshopEstimateApproval', entity_id: approval.id },
    });
    expect(audit).toMatchObject({ action: 'CREATE', actor_type: 'USER', actor_user_id: adminUserId });
    expect(audit.after).toMatchObject({ note: validDecision.note, recorded_by_user_id: adminUserId });
    const event = await prisma.notificationOutbox.findFirstOrThrow({
      where: { event_type: 'CUSTOMER_ESTIMATE_DECIDED', source_entity_id: versionId },
    });
    expect(event).toMatchObject({
      channel: 'IN_APP',
      recipient_kind: 'INTERNAL_TEAM',
      status: 'ACCEPTED',
      workshop_order_id: orderId,
    });
    const timeline = await api()
      .get(`/api/workshop/orders/${orderId}/communications`)
      .set(adminAuth())
      .expect(200);
    expect(timeline.body.data).toContainEqual(
      expect.objectContaining({
        kind: 'ESTIMATE_APPROVAL',
        channel: 'PHONE',
        decision: 'APPROVED',
        version: 1,
      }),
    );
  });

  it('records a declined decision with the channel, reaction and note the advisor gave', async () => {
    const { orderId } = await createOrderWithLabor(1, 60);
    const versionId = await sentVersion(orderId);

    const res = await decide(versionId, {
      decision: 'DECLINED',
      channel: 'IN_PERSON',
      amount_quoted_gross: '72.00',
      customer_reaction: 'QUESTIONED',
      note: '  Kunde möchte den Preis vorher besprechen.  ',
    }).expect(201);

    expect(res.body.status).toBe('DECLINED');
    expect(res.body.approval).toMatchObject({
      channel: 'IN_PERSON',
      decision: 'DECLINED',
      customer_reaction: 'QUESTIONED',
      note: 'Kunde möchte den Preis vorher besprechen.',
    });
  });

  it('refuses an amount that is not the sent gross total, and records nothing', async () => {
    const { orderId } = await createOrderWithLabor(2, 80);
    const versionId = await sentVersion(orderId);

    const res = await decide(versionId, {
      ...validDecision,
      amount_quoted_gross: '180.00',
    }).expect(422);

    expect(res.body.code).toBe('ESTIMATE_AMOUNT_MISMATCH');
    expect(res.body.expected_amount_gross).toBe('192.00');
    expect(
      await prisma.workshopEstimateApproval.count({
        where: { workshop_estimate_version_id: versionId },
      }),
    ).toBe(0);
  });

  it('refuses a link channel, a short note and a future decision time', async () => {
    const { orderId } = await createOrderWithLabor();
    const versionId = await sentVersion(orderId);

    await decide(versionId, { ...validDecision, channel: 'LINK' }).expect(400);
    await decide(versionId, { ...validDecision, note: 'ok' }).expect(400);
    const future = await decide(versionId, {
      ...validDecision,
      decided_at: new Date(Date.now() + 3_600_000).toISOString(),
    }).expect(422);
    expect(future.body.code).toBe('ESTIMATE_DECISION_TIME_INVALID');
  });

  it('refuses a draft version with 409, because only a sent version can be decided', async () => {
    const { orderId } = await createOrderWithLabor();
    const created = await api()
      .post(`/api/workshop/orders/${orderId}/estimates`)
      .set(adminAuth())
      .expect(201);

    const res = await decide(created.body.versions[0].id as string, validDecision).expect(409);
    expect(res.body.code).toBe('ESTIMATE_VERSION_NOT_SENT');
  });

  it('refuses a superseded version with 409 and leaves the current version decidable', async () => {
    const { orderId } = await createOrderWithLabor();
    const firstVersionId = await sentVersion(orderId);
    const revised = await api()
      .post(`/api/workshop/orders/${orderId}/estimates/revisions`)
      .set(adminAuth())
      .expect(201);
    const secondVersionId = revised.body.id as string;
    await api()
      .post(`/api/workshop/estimates/${secondVersionId}/send`)
      .set(adminAuth())
      .expect(200);

    const outdated = await decide(firstVersionId, validDecision).expect(409);
    expect(outdated.body.code).toBe('ESTIMATE_VERSION_SUPERSEDED');
    const current = await decide(secondVersionId, validDecision).expect(201);
    expect(current.body.status).toBe('APPROVED');
  });

  it('refuses a second decision on the same version with 409', async () => {
    const { orderId } = await createOrderWithLabor();
    const versionId = await sentVersion(orderId);
    await decide(versionId, validDecision).expect(201);

    const again = await decide(versionId, { ...validDecision, decision: 'DECLINED' }).expect(409);
    expect(again.body.code).toBe('ESTIMATE_VERSION_ALREADY_DECIDED');
  });

  it('refuses a version whose validity has passed, and marks it expired', async () => {
    const { orderId } = await createOrderWithLabor();
    const versionId = await sentVersion(orderId);
    await prisma.workshopEstimateVersion.updateMany({
      where: { id: versionId },
      data: { valid_until: new Date(Date.now() - 60_000) },
    });

    const res = await decide(versionId, validDecision).expect(409);
    expect(res.body.code).toBe('ESTIMATE_VERSION_EXPIRED');
    const version = await prisma.workshopEstimateVersion.findFirstOrThrow({
      where: { id: versionId },
      select: { status: true },
    });
    expect(version.status).toBe('EXPIRED');
  });

  it('refuses a TECH session on the decision, the overrun notice and resume waiting tasks', async () => {
    const techFirebaseUid = `ap-tech-${randomUUID()}`;
    const techEmail = `${techFirebaseUid}@example.com`;
    const techUser = await basePrisma.user.create({
      data: { firebaseUid: techFirebaseUid, email: techEmail },
    });
    createdUserIds.push(techUser.id);
    await seedTestTenantMember(basePrisma, { tenantId, userId: techUser.id, role: 'TECH' });
    const techToken = app.get(AuthService).createTestToken({
      sub: techFirebaseUid,
      email: techEmail,
      tenantId,
      role: 'TECH',
    });
    const tech = { Authorization: `Bearer ${techToken}` };
    const { orderId } = await createOrderWithLabor();
    const versionId = await sentVersion(orderId);

    await api()
      .post(`/api/workshop/estimates/${versionId}/approve-advisor`)
      .set(tech)
      .send(validDecision)
      .expect(403);
    await api()
      .post(`/api/workshop/orders/${orderId}/overrun/notify`)
      .set(tech)
      .send({ channel: 'PHONE', amount_quoted_gross: '192.00', customer_reaction: 'AGREED', note: 'Hinweis' })
      .expect(403);
    await api()
      .post(`/api/workshop/orders/${orderId}/tasks/resume-waiting`)
      .set(tech)
      .expect(403);
  });

  it('resumes the tasks that wait for the customer, and no others', async () => {
    const { orderId, taskId } = await createOrderWithLabor();
    await prisma.workshopTask.update({
      where: { id: taskId },
      data: { status: 'WAITING_CUSTOMER' },
    });
    await sentVersion(orderId);

    const resumed = await api()
      .post(`/api/workshop/orders/${orderId}/tasks/resume-waiting`)
      .set(adminAuth())
      .expect(200);
    expect(resumed.body.resumed_task_ids).toEqual([taskId]);
    const task = await prisma.workshopTask.findFirstOrThrow({
      where: { id: taskId },
      select: { status: true },
    });
    expect(task.status).toBe('PAUSED');

    const again = await api()
      .post(`/api/workshop/orders/${orderId}/tasks/resume-waiting`)
      .set(adminAuth())
      .expect(200);
    expect(again.body.resumed_task_ids).toEqual([]);
  });

  it('tracks an overrun from the first read, records the advisor notice once, and times it', async () => {
    const { orderId } = await createOrderWithLabor(2, 80);
    const versionId = await sentVersion(orderId);
    await decide(versionId, validDecision).expect(201);
    const extra = await api()
      .post(`/api/workshop/orders/${orderId}/tasks`)
      .set(adminAuth())
      .send({ title: 'Bremsflüssigkeit' })
      .expect(201);
    await addLaborLine(orderId, extra.body.id as string, {
      itemNo: 'LAB-BRF',
      description: 'Bremsflüssigkeit wechseln',
      qty: 1,
      unitPrice: 45,
    });

    const estimate = await api()
      .get(`/api/workshop/orders/${orderId}/estimates`)
      .set(adminAuth())
      .expect(200);
    const warning = estimate.body.data[0].overrun_warning;
    expect(warning).toMatchObject({
      new_work_lines: true,
      current_total_gross: '246.00',
      approved_total_gross: '192.00',
      requires_customer_notice: true,
      notified_at: null,
    });
    expect(warning.detected_at).toEqual(expect.any(String));

    await api()
      .post(`/api/workshop/orders/${orderId}/overrun/notify`)
      .set(adminAuth())
      .send({ channel: 'PHONE', amount_quoted_gross: '190.00', customer_reaction: 'AGREED', note: 'Zusatzarbeit zugestimmt' })
      .expect(422);
    const notice = await api()
      .post(`/api/workshop/orders/${orderId}/overrun/notify`)
      .set(adminAuth())
      .send({ channel: 'PHONE', amount_quoted_gross: '246.00', customer_reaction: 'AGREED', note: 'Zusatzarbeit zugestimmt' })
      .expect(201);
    expect(notice.body).toMatchObject({ version: 1, channel: 'PHONE', amount_quoted_gross: '246.00', customer_reaction: 'AGREED' });

    await api()
      .post(`/api/workshop/orders/${orderId}/overrun/notify`)
      .set(adminAuth())
      .send({ channel: 'PHONE', amount_quoted_gross: '246.00', customer_reaction: 'AGREED', note: 'Zweite Mitteilung' })
      .expect(409);

    const timeline = await api()
      .get(`/api/workshop/orders/${orderId}/communications`)
      .set(adminAuth())
      .expect(200);
    expect(timeline.body.data).toContainEqual(
      expect.objectContaining({ kind: 'OVERRUN_NOTIFICATION', channel: 'PHONE' }),
    );
    const row = await prisma.workshopEstimateOverrun.findFirstOrThrow({
      where: { workshop_estimate_version_id: versionId },
    });
    expect(row.notified_by_user_id).toBe(adminUserId);
    const audit = await prisma.auditLog.findFirst({
      where: { entity_type: 'WorkshopEstimateOverrun', entity_id: row.id, action: 'CREATE' },
    });
    expect(audit).not.toBeNull();
    const noticeAudit = await prisma.auditLog.findFirst({
      where: { entity_type: 'WorkshopEstimateOverrun', entity_id: row.id, action: 'UPDATE' },
    });
    expect(noticeAudit).not.toBeNull();
  });

  it('refuses an overrun notice when the order has no overrun', async () => {
    const { orderId } = await createOrderWithLabor();
    await sentVersion(orderId);

    const res = await api()
      .post(`/api/workshop/orders/${orderId}/overrun/notify`)
      .set(adminAuth())
      .send({ channel: 'EMAIL', amount_quoted_gross: '192.00', customer_reaction: 'NO_RESPONSE', note: 'Kein Aufschlag' })
      .expect(409);
    expect(res.body.code).toBe('OVERRUN_NOT_DETECTED');
  });

  it('refuses a customer reaction that contradicts the decision, and accepts one that fits', async () => {
    const { orderId } = await createOrderWithLabor(2, 80);
    const versionId = await sentVersion(orderId);

    const mismatch = await decide(versionId, { ...validDecision, customer_reaction: 'DECLINED' }).expect(422);
    expect(mismatch.body.code).toBe('ESTIMATE_REACTION_MISMATCH');
    expect(
      await prisma.workshopEstimateApproval.count({
        where: { workshop_estimate_version_id: versionId },
      }),
    ).toBe(0);

    await decide(versionId, { ...validDecision, customer_reaction: 'AGREED' }).expect(201);
  });

  it('takes an explicit null reaction as no reaction', async () => {
    const { orderId } = await createOrderWithLabor(2, 80);
    const versionId = await sentVersion(orderId);

    await decide(versionId, { ...validDecision, customer_reaction: null }).expect(201);
  });

  it('asks for a new notice once the total has moved after the customer was told, and records it', async () => {
    const { orderId } = await createOrderWithLabor(2, 80);
    const versionId = await sentVersion(orderId);
    await decide(versionId, validDecision).expect(201);
    const brake = await api()
      .post(`/api/workshop/orders/${orderId}/tasks`)
      .set(adminAuth())
      .send({ title: 'Bremsflüssigkeit' })
      .expect(201);
    await addLaborLine(orderId, brake.body.id as string, {
      itemNo: 'LAB-BRF',
      description: 'Bremsflüssigkeit wechseln',
      qty: 1,
      unitPrice: 45,
    });
    await api()
      .post(`/api/workshop/orders/${orderId}/overrun/notify`)
      .set(adminAuth())
      .send({ channel: 'PHONE', amount_quoted_gross: '246.00', customer_reaction: 'AGREED', note: 'Zusatzarbeit zugestimmt' })
      .expect(201);

    // One more line moves the total past the notified amount, so the customer has to be told the new total.
    const filter = await api()
      .post(`/api/workshop/orders/${orderId}/tasks`)
      .set(adminAuth())
      .send({ title: 'Filter' })
      .expect(201);
    await addLaborLine(orderId, filter.body.id as string, {
      itemNo: 'LAB-FIL',
      description: 'Filter',
      qty: 1,
      unitPrice: 30,
    });
    const estimate = await api()
      .get(`/api/workshop/orders/${orderId}/estimates`)
      .set(adminAuth())
      .expect(200);
    expect(estimate.body.data[0].overrun_warning).toMatchObject({
      current_total_gross: '282.00',
      requires_customer_notice: true,
    });

    const renotice = await api()
      .post(`/api/workshop/orders/${orderId}/overrun/notify`)
      .set(adminAuth())
      .send({ channel: 'EMAIL', amount_quoted_gross: '282.00', customer_reaction: 'QUESTIONED', note: 'Rückfrage zum Filter' })
      .expect(201);
    expect(renotice.body).toMatchObject({ channel: 'EMAIL', amount_quoted_gross: '282.00' });

    const timeline = await api()
      .get(`/api/workshop/orders/${orderId}/communications`)
      .set(adminAuth())
      .expect(200);
    expect(timeline.body.data.filter((entry: { kind: string }) => entry.kind === 'OVERRUN_NOTIFICATION')).toEqual([
      expect.objectContaining({ channel: 'EMAIL' }),
    ]);
  });

  it('records the overrun when the line is added, so the timeline shows it without anyone reading the estimate', async () => {
    const { orderId } = await createOrderWithLabor(2, 80);
    const versionId = await sentVersion(orderId);
    await decide(versionId, validDecision).expect(201);
    const brake = await api()
      .post(`/api/workshop/orders/${orderId}/tasks`)
      .set(adminAuth())
      .send({ title: 'Bremsflüssigkeit' })
      .expect(201);

    await addLaborLine(orderId, brake.body.id as string, {
      itemNo: 'LAB-BRF',
      description: 'Bremsflüssigkeit wechseln',
      qty: 1,
      unitPrice: 45,
    });

    expect(
      await prisma.workshopEstimateOverrun.count({
        where: { workshop_estimate_version_id: versionId },
      }),
    ).toBe(1);
    const timeline = await api()
      .get(`/api/workshop/orders/${orderId}/communications`)
      .set(adminAuth())
      .expect(200);
    expect(timeline.body.data).toContainEqual(
      expect.objectContaining({ kind: 'OVERRUN_DETECTED', version: 1, channel: null }),
    );
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
