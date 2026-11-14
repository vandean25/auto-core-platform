import { INestApplication } from '@nestjs/common';
import {
  CreditNoteStatus,
  RksvMode,
  TenantMemberRole,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { FiskalySignAtFixtureProvider } from '../src/settlement/fiskaly-sign-at-fixture.provider.js';
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
    app = await createE2eApp();
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
        customer_id: customerId,
        vehicle_id: vehicleId,
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
      .put(`/api/sales/invoices/${draftRes.body.id}/finalize`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    return finalizedRes.body as {
      id: string;
      total_gross: string;
      items: Array<{ id: string }>;
    };
  }

  async function createCreditNote(
    invoiceId: string,
    invoiceItemId: string,
    quantity: number,
    finalize: boolean,
  ) {
    const draftRes = await request(app.getHttpServer())
      .post(`/api/invoices/${invoiceId}/credit-notes`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        reason: 'AUT-916 test credit note',
        items: [{ originalInvoiceItemId: invoiceItemId, quantity }],
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

  it('WHEN an invoice has a finalized partial credit note and settlement is requested THEN it fails with SETTLEMENT_INVOICE_HAS_CREDIT_NOTES and no fiskaly call is made', async () => {
    const invoice = await createIssuedWorkshopInvoice();
    await createCreditNote(invoice.id, invoice.items[0].id, 1, true);
    const idempotencyKey = randomUUID();

    const first = await request(app.getHttpServer())
      .post(`/api/invoices/${invoice.id}/settlement`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ idempotencyKey, method: 'CASH' })
      .expect(422);

    expect(first.body.code).toBe(
      SETTLEMENT_ERROR_CODES.SETTLEMENT_INVOICE_HAS_CREDIT_NOTES,
    );

    const repeated = await request(app.getHttpServer())
      .post(`/api/invoices/${invoice.id}/settlement`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ idempotencyKey, method: 'CASH' })
      .expect(422);

    expect(repeated.body.code).toBe(
      SETTLEMENT_ERROR_CODES.SETTLEMENT_INVOICE_HAS_CREDIT_NOTES,
    );
    expect(fiskalyProvider.contractServer.calls).toHaveLength(0);
  });

  it('WHEN an invoice has a finalized full credit note and settlement is requested THEN it fails with the same code and no RKSV payment line is written', async () => {
    const invoice = await createIssuedWorkshopInvoice();
    await createCreditNote(invoice.id, invoice.items[0].id, 2, true);

    const res = await request(app.getHttpServer())
      .post(`/api/invoices/${invoice.id}/settlement`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ idempotencyKey: randomUUID(), method: 'CASH' })
      .expect(422);

    expect(res.body.code).toBe(
      SETTLEMENT_ERROR_CODES.SETTLEMENT_INVOICE_HAS_CREDIT_NOTES,
    );
    const paymentCount = await tenantPrisma.payment.count({
      where: { tenant_id: tenant.tenantId, invoice_id: invoice.id },
    });
    expect(paymentCount).toBe(0);
    expect(fiskalyProvider.contractServer.calls).toHaveLength(0);
  });

  it('WHEN an invoice has only a draft credit note THEN settlement succeeds as before', async () => {
    const invoice = await createIssuedWorkshopInvoice();
    const draft = await createCreditNote(
      invoice.id,
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
    await createCreditNote(invoice.id, invoice.items[0].id, 1, true);

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
