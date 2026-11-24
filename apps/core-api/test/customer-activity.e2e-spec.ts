import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  seedTestTenantMember,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

jest.setTimeout(30000);

describe('Customer activity timeline (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prismaA: PrismaService;
  let prismaB: PrismaService;
  let tenantAId: string;
  let tenantBId: string;
  let salesTokenA: string;
  let techTokenA: string;
  let tokenB: string;
  let customerAId: string;
  let customerBId: string;
  let siteAId: string;
  let legalEntityAId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    basePrisma = app.get<PrismaService>(PrismaService);
    const authService = app.get<AuthService>(AuthService);

    const tenantA = await createTestTenant(basePrisma, 'aut1039a');
    const tenantB = await createTestTenant(basePrisma, 'aut1039b');
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;

    salesTokenA = createTestAuthToken(authService, tenantA, { role: 'SALES' });
    const techUserA = await basePrisma.user.create({
      data: {
        firebaseUid: `e2e-tech-${Date.now()}`,
        email: `tech-1039-${Date.now()}@example.com`,
      },
    });
    await seedTestTenantMember(basePrisma, {
      tenantId: tenantAId,
      userId: techUserA.id,
      role: 'TECH',
    });
    techTokenA = createTestAuthToken(authService, tenantA, {
      sub: techUserA.firebaseUid ?? undefined,
      email: techUserA.email ?? undefined,
      role: 'TECH',
    });
    tokenB = createTestAuthToken(authService, tenantB, { role: 'SALES' });

    prismaA = createTenantAwarePrisma(basePrisma, tenantAId);
    prismaB = createTenantAwarePrisma(basePrisma, tenantBId);

    const [siteA, siteB, legalEntityA] = await Promise.all([
      prismaA.site.findFirst({
        where: { tenant_id: tenantAId },
        select: { id: true },
      }),
      prismaB.site.findFirst({
        where: { tenant_id: tenantBId },
        select: { id: true },
      }),
      prismaA.legalEntity.findFirst({
        where: { tenant_id: tenantAId, is_active: true },
        select: { id: true },
      }),
    ]);
    siteAId = siteA!.id;
    const siteBId = siteB!.id;
    legalEntityAId = legalEntityA!.id;

    const customerA = await prismaA.customer.create({
      data: {
        tenant_id: tenantAId,
        first_name: 'Anna',
        last_name: 'Muster',
        email: `aut1039a-${Date.now()}@example.com`,
        type: 'PRIVATE',
      },
    });
    customerAId = customerA.id;

    const customerB = await prismaB.customer.create({
      data: {
        tenant_id: tenantBId,
        first_name: 'Anna',
        last_name: 'Muster',
        email: `aut1039b-${Date.now()}@example.com`,
        type: 'PRIVATE',
      },
    });
    customerBId = customerB.id;

    const baseTime = new Date();
    const atOffset = (minutesAgo: number) =>
      new Date(baseTime.getTime() - minutesAgo * 60_000);

    const vehicleA = await prismaA.vehicle.create({
      data: {
        tenant_id: tenantAId,
        customer_id: customerAId,
        make: 'VW',
        model: 'Golf',
        year: 2022,
        plate: 'W-1039A',
        vin: `WVWZZZ1JZXW${Date.now().toString().slice(-6)}`,
      },
    });

    const vehicleB = await prismaB.vehicle.create({
      data: {
        tenant_id: tenantBId,
        customer_id: customerBId,
        make: 'VW',
        model: 'Golf',
        year: 2022,
        plate: 'W-1039B',
        vin: `WVWZZZ1JZYW${Date.now().toString().slice(-6)}`,
      },
    });

    const workshopOrderA = await prismaA.workshopOrder.create({
      data: {
        tenant_id: tenantAId,
        site_id: siteAId,
        customer_id: customerAId,
        vehicle_id: vehicleA.id,
        order_number: `WO-1039-${Date.now()}`,
        status: 'INVOICED',
        odometer: 45000,
        fuel_level: 50,
        createdAt: atOffset(60),
      },
    });

    const invoiceA = await prismaA.invoice.create({
      data: {
        tenant_id: tenantAId,
        site_id: siteAId,
        legal_entity_id: legalEntityAId,
        customer_id: customerAId,
        vehicle_id: vehicleA.id,
        workshop_order_id: workshopOrderA.id,
        invoice_number: `RE-1039-SECRET-${Date.now()}`,
        status: 'FINALIZED',
        date: atOffset(50),
        due_date: atOffset(-1440),
        total_net: '100.00',
        total_tax: '20.00',
        total_gross: '120.00',
      },
    });

    await prismaB.invoice.create({
      data: {
        tenant_id: tenantBId,
        site_id: siteBId,
        customer_id: customerBId,
        vehicle_id: vehicleB.id,
        invoice_number: `RE-B-1039-${Date.now()}`,
        status: 'FINALIZED',
        date: atOffset(45),
        due_date: atOffset(-1440),
        total_net: '200.00',
        total_tax: '40.00',
        total_gross: '240.00',
      },
    });

    await prismaA.creditNote.create({
      data: {
        tenant_id: tenantAId,
        site_id: siteAId,
        legal_entity_id: legalEntityAId,
        original_invoice_id: invoiceA.id,
        credit_number: `GS-1039-${Date.now()}`,
        status: 'FINALIZED',
        date: atOffset(40),
        reason: 'Kulanz',
        total_net: '10.00',
        total_tax: '2.00',
        total_gross: '12.00',
        createdAt: atOffset(40),
      },
    });

    await prismaA.notificationOutbox.create({
      data: {
        tenant_id: tenantAId,
        event_type: 'WORKSHOP_ORDER_READY',
        idempotency_key: `aut1039-mail-${Date.now()}`,
        channel: 'EMAIL',
        recipient_kind: 'CUSTOMER',
        recipient_email: customerA.email,
        workshop_order_id: workshopOrderA.id,
        template_id: 'workshop_order_ready',
        subject: 'Ihr Fahrzeug ist abholbereit',
        body: 'SENSITIVE_MAIL_BODY_MUST_NOT_LEAK',
        status: 'ACCEPTED',
        accepted_at: atOffset(30),
        createdAt: atOffset(30),
      },
    });

    await prismaA.customerConsent.create({
      data: {
        tenant_id: tenantAId,
        controller_legal_entity_id: legalEntityAId,
        customer_id: customerAId,
        channel: 'EMAIL',
        purpose: 'NEWSLETTER',
        status: 'GRANTED',
        sequence: 1,
        source: 'PROFILE',
        occurred_at: atOffset(25),
      },
    });

    await prismaA.customerConsent.create({
      data: {
        tenant_id: tenantAId,
        controller_legal_entity_id: legalEntityAId,
        customer_id: customerAId,
        channel: 'EMAIL',
        purpose: 'NEWSLETTER',
        status: 'REVOKED',
        sequence: 2,
        source: 'PROFILE',
        occurred_at: atOffset(20),
      },
    });

    await prismaA.auditLog.create({
      data: {
        tenant_id: tenantAId,
        entity_type: 'Customer',
        entity_id: customerAId,
        action: 'UPDATE',
        actor_email: 'admin@example.com',
        actor_role: 'ADMIN',
        actor_type: 'USER',
        changed_fields: ['vat_id'],
        redacted_fields: ['vat_id'],
        diff: { vat_id: { from: 'CLEAR_SECRET_OLD', to: 'CLEAR_SECRET_NEW' } },
        occurred_at: atOffset(10),
      },
    });
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(prismaA, tenantAId);
    await cleanupTestTenantGraph(prismaB, tenantBId);
    await teardownTestApp(app);
  });

  it('returns closed workshop order, invoice, outbox mail without body, and ordered consents newest first', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/customers/${customerAId}/activity`)
      .set('Authorization', `Bearer ${salesTokenA}`)
      .expect(200);

    const items = res.body.data as Array<{
      type: string;
      occurred_at: string;
      title: string;
      ref_id: string;
      ref_link: string | null;
      summary: Record<string, unknown>;
    }>;

    // Scenario 2: closed workshop order and invoice appear with links
    const wo = items.find((i) => i.type === 'workshop_order');
    const inv = items.find((i) => i.type === 'invoice');
    expect(wo?.ref_link).toMatch(/^\/workshop\/orders\//);
    expect(inv?.ref_link).toMatch(/^\/sales\/invoices\//);

    // Scenario 3: outbox mail appears with subject/template and status, without body
    const mail = items.find((i) => i.type === 'email');
    expect(mail?.summary).toMatchObject({
      subject: 'Ihr Fahrzeug ist abholbereit',
      template_id: 'workshop_order_ready',
      status: 'ACCEPTED',
    });
    expect(JSON.stringify(res.body)).not.toContain(
      'SENSITIVE_MAIL_BODY_MUST_NOT_LEAK',
    );

    // Scenario 4: consent granted and later revoked appear in newest-first order
    const consents = items.filter((i) => i.type === 'consent');
    expect(consents.map((c) => c.summary.status)).toEqual([
      'REVOKED',
      'GRANTED',
    ]);

    // Anti-criterion 1: no tenant B data appears
    expect(JSON.stringify(res.body)).not.toContain('RE-B-1039-');
    expect(JSON.stringify(res.body)).not.toContain(customerBId);
  });

  it('filters by types=invoice,credit_note', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/customers/${customerAId}/activity?types=invoice,credit_note`)
      .set('Authorization', `Bearer ${salesTokenA}`)
      .expect(200);

    const types = (res.body.data as Array<{ type: string }>).map(
      (item) => item.type,
    );
    expect(types.length).toBe(2);
    expect(types).toEqual(['credit_note', 'invoice']);
  });

  it('omits invoices and credit notes for a role without invoice.read without leaking numbers', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/customers/${customerAId}/activity`)
      .set('Authorization', `Bearer ${techTokenA}`)
      .expect(200);

    const types = (res.body.data as Array<{ type: string }>).map(
      (item) => item.type,
    );
    expect(types).not.toContain('invoice');
    expect(types).not.toContain('credit_note');
    expect(JSON.stringify(res.body)).not.toContain('RE-1039-SECRET-');
    expect(JSON.stringify(res.body)).not.toContain('GS-1039-');
  });

  it('masks redacted_fields in audit entries for a role with customer.read', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/customers/${customerAId}/activity?types=audit`)
      .set('Authorization', `Bearer ${salesTokenA}`)
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    const payload = JSON.stringify(res.body);
    expect(payload).not.toContain('CLEAR_SECRET_OLD');
    expect(payload).not.toContain('CLEAR_SECRET_NEW');
    expect(payload).toContain('[REDACTED]');
  });

  it('returns 404 when tenant B requests tenant A customer activity', async () => {
    await request(app.getHttpServer())
      .get(`/api/customers/${customerAId}/activity`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  it('paginates across pages via cursor without duplicates or gaps', async () => {
    const allIds: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const qs: string = cursor
        ? `?limit=2&cursor=${encodeURIComponent(cursor)}`
        : '?limit=2';
      const res: request.Response = await request(app.getHttpServer())
        .get(`/api/customers/${customerAId}/activity${qs}`)
        .set('Authorization', `Bearer ${salesTokenA}`)
        .expect(200);

      const body = res.body as {
        data: Array<{ id: string }>;
        meta: { nextCursor: string | null };
      };
      for (const item of body.data) {
        allIds.push(item.id);
      }
      cursor = body.meta.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);

    const full = await request(app.getHttpServer())
      .get(`/api/customers/${customerAId}/activity?limit=50`)
      .set('Authorization', `Bearer ${salesTokenA}`)
      .expect(200);

    const fullIds = (full.body.data as Array<{ id: string }>).map((i) => i.id);
    expect(allIds).toEqual(fullIds);
    expect(new Set(allIds).size).toBe(allIds.length);
  });
});
