import { INestApplication } from '@nestjs/common';
import {
  CreditNoteStatus,
  InvoiceStatus,
  Prisma,
  RksvMode,
  TenantMemberRole,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { FiskalySignAtFixtureProvider } from '../src/settlement/fiskaly-sign-at-fixture.provider.js';
import { FiskalySignAtHttpAdapter } from '../src/settlement/fiskaly-sign-at-http.adapter.js';
import { FISKALY_SIGN_AT_PROVIDER } from '../src/settlement/fiskaly-sign-at.types.js';
import { SETTLEMENT_ERROR_CODES } from '../src/settlement/settlement.constants.js';
import { createE2eApp } from './helpers/e2e-suite.js';
import {
  seedInvoiceReadyCustomer,
  seedReadySellerAndAccountingProfile,
} from './invoice-snapshot-v2-test-utils.js';
import {
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('Settlement credit-note block (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: PrismaService;
  let authService: AuthService;
  let fiskalyProvider: FiskalySignAtFixtureProvider;
  let tenant: TestTenantResult;
  let authToken: string;
  let siteId: string;
  let legalEntityId: string;
  let customerId: string;
  let vehicleId: string;

  beforeAll(async () => {
    app = await createE2eApp(undefined, { productionErrorFilter: true });
    prisma = app.get<PrismaService>(PrismaService);
    authService = app.get<AuthService>(AuthService);
    fiskalyProvider = app.get(FiskalySignAtFixtureProvider);

    tenant = await createTestTenant(prisma, 'aut916');
    tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    authToken = createTestAuthToken(authService, tenant);
    siteId = await resolveTestMainSiteId(prisma, tenant.tenantId);

    const { entity } = await seedReadySellerAndAccountingProfile(
      prisma,
      tenant.tenantId,
    );
    legalEntityId = entity.id;

    await tenantPrisma.legalEntity.update({
      where: { id: legalEntityId },
      data: { rksv_mode: RksvMode.REQUIRED_ACP_RKSV },
    });

    await tenantPrisma.fiscalRegister.create({
      data: {
        tenant_id: tenant.tenantId,
        site_id: siteId,
        legal_entity_id: legalEntityId,
        provider: 'FISKALY_SIGN_AT_1_2_6',
        provider_cash_register_id: randomUUID(),
        provider_scu_id: randomUUID(),
        provider_state: 'INITIALIZED',
        env: 'TEST',
      },
    });

    const customer = await seedInvoiceReadyCustomer(prisma, tenant.tenantId);
    customerId = customer.id;

    const vehicle = await tenantPrisma.vehicle.create({
      data: {
        tenant_id: tenant.tenantId,
        customer_id: customerId,
        make: 'VW',
        model: 'Golf',
        year: 2022,
        vin: `WVWZZZ1KZ6W${Date.now().toString().slice(-6)}`,
      },
    });
    vehicleId = vehicle.id;
  });

  beforeEach(() => {
    fiskalyProvider.contractServer.reset();
  });

  afterAll(async () => {
    await teardownTestApp(app);
  });

  async function createIssuedWorkshopInvoice() {
    const orderRes = await request(app.getHttpServer())
      .post('/api/workshop/orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        vehicleId,
        odometer: 120000,
        fuelLevel: 40,
        notes: 'AUT-916 settlement test',
      })
      .expect(201);

    const taskRes = await request(app.getHttpServer())
      .post(`/api/workshop/orders/${orderRes.body.id}/tasks`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ title: 'Brake service' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(
        `/api/workshop/orders/${orderRes.body.id}/tasks/${taskRes.body.id}/line-items`,
      )
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expectedLineItemsVersion: 0,
        items: [
          {
            type: 'LABOR',
            itemNo: 'LAB-916',
            description: 'Brake labor',
            qty: 2,
            unitPrice: 50,
          },
        ],
      })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/workshop/orders/${orderRes.body.id}/tasks/${taskRes.body.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'DONE' })
      .expect(200);

    const draftRes = await request(app.getHttpServer())
      .post('/api/invoices/drafts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ workshopOrderId: orderRes.body.id })
      .expect(201);

    const finalizedRes = await request(app.getHttpServer())
      .patch(`/api/invoices/${draftRes.body.id}/issue`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    return finalizedRes.body as {
      id: string;
      date: string;
      total_gross: string;
      items: Array<{ id: string }>;
    };
  }

  async function createCreditNote(
    invoiceId: string,
    invoiceDate: string,
    invoiceItemId: string,
    quantity: number,
    finalize: boolean,
  ) {
    const creditDate = new Date(invoiceDate).toISOString().slice(0, 10);
    const draftRes = await request(app.getHttpServer())
      .post(`/api/invoices/${invoiceId}/credit-notes`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        date: creditDate,
        reason: 'AUT-916 test credit note',
        mode: quantity >= 2 ? 'FULL' : 'PARTIAL',
        ...(quantity >= 2
          ? {}
          : {
              lines: [
                {
                  originalItemId: invoiceItemId,
                  quantity: quantity.toFixed(3),
                },
              ],
            }),
      })
      .expect(201);

    if (finalize) {
      await request(app.getHttpServer())
        .post(`/api/credit-notes/${draftRes.body.id}/finalize`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          expectedVersion: 1,
          idempotencyKey: randomUUID(),
        })
        .expect(201);
    }

    return draftRes.body as { id: string };
  }

  async function finalizedCreditTotal(creditNoteId: string) {
    const stored = await tenantPrisma.creditNote.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId, id: creditNoteId },
    });
    expect(stored.status).toBe(CreditNoteStatus.FINALIZED);
    return stored.total_gross;
  }

  async function signedAmounts(invoiceId: string): Promise<string[]> {
    const receipts = await tenantPrisma.fiscalReceipt.findMany({
      where: { tenant_id: tenant.tenantId, payment: { invoice_id: invoiceId } },
    });
    return receipts.map(
      (receipt) =>
        (
          receipt.request_body as {
            schema: {
              standard_v1: {
                amounts_per_payment_type: Array<{ amount: string }>;
              };
            };
          }
        ).schema.standard_v1.amounts_per_payment_type[0].amount,
    );
  }

  it('WHEN an invoice has a finalized partial credit note and is settled in cash THEN the outstanding amount is collected, the invoice is PAID and no signature for the gross amount is created', async () => {
    const invoice = await createIssuedWorkshopInvoice();
    const creditNote = await createCreditNote(
      invoice.id,
      invoice.date,
      invoice.items[0].id,
      1,
      true,
    );
    const credited = await finalizedCreditTotal(creditNote.id);
    const outstanding = new Prisma.Decimal(invoice.total_gross)
      .minus(credited)
      .toFixed(2);
    expect(Number(outstanding)).toBeGreaterThan(0);
    expect(outstanding).not.toBe(Number(invoice.total_gross).toFixed(2));

    const res = await request(app.getHttpServer())
      .post(`/api/invoices/${invoice.id}/settlement`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ idempotencyKey: randomUUID(), method: 'CASH' })
      .expect(201);

    expect(res.body.payment?.status).toBe('SETTLED');
    expect(res.body.payment?.amount).toBe(outstanding);
    expect(res.body.invoiceStatus).toBe('PAID');
    expect(await signedAmounts(invoice.id)).toEqual([outstanding]);
    expect(fiskalyProvider.contractServer.calls).toHaveLength(1);
  });

  it('WHEN a full credit note brings the outstanding amount to 0 THEN settlement is refused with SETTLEMENT_NOTHING_OUTSTANDING and nothing is written', async () => {
    const invoice = await createIssuedWorkshopInvoice();
    await createCreditNote(invoice.id, invoice.date, invoice.items[0].id, 2, true);

    const res = await request(app.getHttpServer())
      .post(`/api/invoices/${invoice.id}/settlement`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ idempotencyKey: randomUUID(), method: 'CASH' })
      .expect(422);

    expect(res.body.code).toBe(
      SETTLEMENT_ERROR_CODES.SETTLEMENT_NOTHING_OUTSTANDING,
    );
    const paymentCount = await tenantPrisma.payment.count({
      where: { tenant_id: tenant.tenantId, invoice_id: invoice.id },
    });
    expect(paymentCount).toBe(0);
    expect(fiskalyProvider.contractServer.calls).toHaveLength(0);
  });

  it('WHEN credited plus paid exceeds the gross amount THEN settlement is rejected (no refund flow), no payment row and no fiscal receipt exist', async () => {
    const invoice = await createIssuedWorkshopInvoice();
    const creditNote = await createCreditNote(
      invoice.id,
      invoice.date,
      invoice.items[0].id,
      2,
      true,
    );
    await tenantPrisma.creditNote.update({
      where: { id: creditNote.id },
      data: {
        total_gross: new Prisma.Decimal(invoice.total_gross).plus(10),
      },
    });

    const res = await request(app.getHttpServer())
      .post(`/api/invoices/${invoice.id}/settlement`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ idempotencyKey: randomUUID(), method: 'CASH' })
      .expect(422);

    expect(res.body.code).toBe(
      SETTLEMENT_ERROR_CODES.SETTLEMENT_NOTHING_OUTSTANDING,
    );
    expect(
      await tenantPrisma.payment.count({
        where: { tenant_id: tenant.tenantId, invoice_id: invoice.id },
      }),
    ).toBe(0);
    expect(await signedAmounts(invoice.id)).toEqual([]);
    expect(fiskalyProvider.contractServer.calls).toHaveLength(0);
  });

  it('WHEN the same settlement request is repeated after a partial credit note THEN it is idempotent and returns the original payment', async () => {
    const invoice = await createIssuedWorkshopInvoice();
    await createCreditNote(invoice.id, invoice.date, invoice.items[0].id, 1, true);
    const body = { idempotencyKey: randomUUID(), method: 'CASH' };

    const first = await request(app.getHttpServer())
      .post(`/api/invoices/${invoice.id}/settlement`)
      .set('Authorization', `Bearer ${authToken}`)
      .send(body)
      .expect(201);
    const repeated = await request(app.getHttpServer())
      .post(`/api/invoices/${invoice.id}/settlement`)
      .set('Authorization', `Bearer ${authToken}`)
      .send(body)
      .expect(201);

    expect(repeated.body.payment.id).toBe(first.body.payment.id);
    expect(repeated.body.payment.amount).toBe(first.body.payment.amount);
    expect(
      await tenantPrisma.payment.count({
        where: { tenant_id: tenant.tenantId, invoice_id: invoice.id },
      }),
    ).toBe(1);
    expect(fiskalyProvider.contractServer.calls).toHaveLength(1);
  });

  it('WHEN the settlement GET is read after a finalized partial credit note THEN it exposes the outstanding amount', async () => {
    const invoice = await createIssuedWorkshopInvoice();
    const creditNote = await createCreditNote(
      invoice.id,
      invoice.date,
      invoice.items[0].id,
      1,
      true,
    );
    const credited = await finalizedCreditTotal(creditNote.id);

    const res = await request(app.getHttpServer())
      .get(`/api/invoices/${invoice.id}/settlement`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body.outstanding).toBe(
      new Prisma.Decimal(invoice.total_gross).minus(credited).toFixed(2),
    );
  });

  it("WHEN another tenant tries to settle this tenant's invoice THEN it gets 404", async () => {
    const invoice = await createIssuedWorkshopInvoice();
    const otherTenant = await createTestTenant(prisma, 'aut1069b');
    const otherToken = createTestAuthToken(authService, otherTenant);

    await request(app.getHttpServer())
      .post(`/api/invoices/${invoice.id}/settlement`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ idempotencyKey: randomUUID(), method: 'CASH' })
      .expect(404);
  });

  it('WHEN an invoice has only a draft credit note THEN settlement succeeds as before', async () => {
    const invoice = await createIssuedWorkshopInvoice();
    const draft = await createCreditNote(
      invoice.id,
      invoice.date,
      invoice.items[0].id,
      1,
      false,
    );
    const storedDraft = await tenantPrisma.creditNote.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId, id: draft.id },
    });
    expect(storedDraft.status).toBe(CreditNoteStatus.DRAFT);

    const res = await request(app.getHttpServer())
      .post(`/api/invoices/${invoice.id}/settlement`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ idempotencyKey: randomUUID(), method: 'CASH' })
      .expect(201);

    expect(res.body.payment?.status).toBe('SETTLED');
    expect(res.body.invoiceStatus).toBe('PAID');
  });

  it('WHEN an invoice has no credit notes THEN settlement succeeds with total_gross unchanged', async () => {
    const invoice = await createIssuedWorkshopInvoice();

    const res = await request(app.getHttpServer())
      .post(`/api/invoices/${invoice.id}/settlement`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ idempotencyKey: randomUUID(), method: 'CARD' })
      .expect(201);

    expect(res.body.payment?.status).toBe('SETTLED');
    expect(Number(res.body.payment?.amount)).toBeCloseTo(
      Number(invoice.total_gross),
    );
  });

  it('WHEN a user without the settlement permission requests settlement THEN the API still returns 403', async () => {
    const invoice = await createIssuedWorkshopInvoice();
    await createCreditNote(invoice.id, invoice.date, invoice.items[0].id, 1, true);

    const salesUser = await tenantPrisma.user.create({
      data: {
        email: `sales-aut916-${Date.now()}@example.com`,
        firebaseUid: `fb-sales-aut916-${Date.now()}`,
        active_tenant_id: tenant.tenantId,
        active_site_id: siteId,
      },
    });
    await tenantPrisma.tenantMember.create({
      data: {
        tenant_id: tenant.tenantId,
        user_id: salesUser.id,
        role: TenantMemberRole.SALES,
        is_active: true,
      },
    });
    await tenantPrisma.siteMembership.create({
      data: {
        tenant_id: tenant.tenantId,
        site_id: siteId,
        user_id: salesUser.id,
      },
    });
    const salesToken = createTestAuthToken(authService, tenant, {
      sub: salesUser.firebaseUid ?? undefined,
      email: salesUser.email,
      role: TenantMemberRole.SALES,
    });

    await request(app.getHttpServer())
      .post(`/api/invoices/${invoice.id}/settlement`)
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ idempotencyKey: randomUUID(), method: 'CASH' })
      .expect(403);
  });
});

describe('Settlement REQUIRED_ACP_RKSV fail-closed (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: PrismaService;
  let authService: AuthService;
  let tenant: TestTenantResult;
  let authToken: string;
  let customerId: string;
  let vehicleId: string;

  beforeAll(async () => {
    app = await createE2eApp(
      (builder) =>
        builder
          .overrideProvider(FISKALY_SIGN_AT_PROVIDER)
          .useValue(new FiskalySignAtHttpAdapter(null, false)),
      { productionErrorFilter: true },
    );
    prisma = app.get<PrismaService>(PrismaService);
    authService = app.get<AuthService>(AuthService);

    tenant = await createTestTenant(prisma, 'aut1071');
    tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    authToken = createTestAuthToken(authService, tenant);
    const siteId = await resolveTestMainSiteId(prisma, tenant.tenantId);

    const { entity } = await seedReadySellerAndAccountingProfile(
      prisma,
      tenant.tenantId,
    );
    await tenantPrisma.legalEntity.update({
      where: { id: entity.id },
      data: { rksv_mode: RksvMode.REQUIRED_ACP_RKSV },
    });
    await tenantPrisma.fiscalRegister.create({
      data: {
        tenant_id: tenant.tenantId,
        site_id: siteId,
        legal_entity_id: entity.id,
        provider: 'FISKALY_SIGN_AT_1_2_6',
        provider_cash_register_id: randomUUID(),
        provider_scu_id: randomUUID(),
        provider_state: 'INITIALIZED',
        env: 'TEST',
      },
    });

    const customer = await seedInvoiceReadyCustomer(prisma, tenant.tenantId);
    customerId = customer.id;
    const vehicle = await tenantPrisma.vehicle.create({
      data: {
        tenant_id: tenant.tenantId,
        customer_id: customerId,
        make: 'VW',
        model: 'Golf',
        year: 2022,
        vin: `WVWZZZ1KZ7W${Date.now().toString().slice(-6)}`,
      },
    });
    vehicleId = vehicle.id;
  });

  afterAll(async () => {
    await teardownTestApp(app);
  });

  it('WHEN an entity already has REQUIRED_ACP_RKSV and live signing is off THEN settlement is rejected, no FiscalReceipt is stored and the invoice stays unpaid', async () => {
    const orderRes = await request(app.getHttpServer())
      .post('/api/workshop/orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        vehicleId,
        odometer: 50000,
        fuelLevel: 50,
        notes: 'AUT-1071 fail-closed test',
      })
      .expect(201);

    const taskRes = await request(app.getHttpServer())
      .post(`/api/workshop/orders/${orderRes.body.id}/tasks`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ title: 'Inspection' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(
        `/api/workshop/orders/${orderRes.body.id}/tasks/${taskRes.body.id}/line-items`,
      )
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expectedLineItemsVersion: 0,
        items: [
          {
            type: 'LABOR',
            itemNo: 'LAB-1071',
            description: 'Inspection labor',
            qty: 1,
            unitPrice: 100,
          },
        ],
      })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/workshop/orders/${orderRes.body.id}/tasks/${taskRes.body.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'DONE' })
      .expect(200);

    const draftRes = await request(app.getHttpServer())
      .post('/api/invoices/drafts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ workshopOrderId: orderRes.body.id })
      .expect(201);

    const invoiceRes = await request(app.getHttpServer())
      .patch(`/api/invoices/${draftRes.body.id}/issue`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .post(`/api/invoices/${invoiceRes.body.id}/settlement`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ idempotencyKey: randomUUID(), method: 'CASH' })
      .expect(422);

    expect(res.body.code).toBe(SETTLEMENT_ERROR_CODES.ACP_RKSV_UNAVAILABLE);

    const paymentCount = await tenantPrisma.payment.count({
      where: { tenant_id: tenant.tenantId, invoice_id: invoiceRes.body.id },
    });
    expect(paymentCount).toBe(0);

    const receiptCount = await tenantPrisma.fiscalReceipt.count({
      where: {
        tenant_id: tenant.tenantId,
        payment: { invoice_id: invoiceRes.body.id },
      },
    });
    expect(receiptCount).toBe(0);

    const storedInvoice = await tenantPrisma.invoice.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId, id: invoiceRes.body.id },
    });
    expect(storedInvoice.status).toBe(InvoiceStatus.ISSUED);
  });
});

