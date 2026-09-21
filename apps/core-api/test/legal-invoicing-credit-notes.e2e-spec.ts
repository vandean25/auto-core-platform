import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
  type TestTenantResult,
} from './tenant-test-utils.js';
import {
  seedInvoiceReadyCustomer,
  seedReadySellerAndAccountingProfile,
} from './invoice-snapshot-v2-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('Legal invoicing credit notes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: PrismaService;
  let authService: AuthService;
  let tenant: TestTenantResult;
  let authToken: string;
  let siteId: string;
  let customerId: string;
  let catalogItemId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    authService = app.get<AuthService>(AuthService);

    tenant = await createTestTenant(prisma, 'aut302');
    tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    authToken = createTestAuthToken(authService, tenant);
    siteId = await resolveTestMainSiteId(prisma, tenant.tenantId);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "credit_note_items",
        "credit_notes",
        "credit_note_sequences",
        "inventory_transactions",
        "inventory_stocks",
        "invoice_items",
        "invoices",
        "invoice_sequences",
        "sales_order_items",
        "sales_orders"
      CASCADE;
    `);

    await seedReadySellerAndAccountingProfile(prisma, tenant.tenantId);
    const customer = await seedInvoiceReadyCustomer(prisma, tenant.tenantId);
    customerId = customer.id;

    const catalogItem = await tenantPrisma.catalogItem.create({
      data: {
        sku: `AUT302-${Date.now()}`,
        name: 'Oil Filter',
        cost_price: 5,
        retail_price: 12,
      },
    });
    catalogItemId = catalogItem.id;

    const location = await tenantPrisma.storageLocation.create({
      data: {
        code: `LOC-${Date.now()}`,
        name: 'Warehouse',
        type: 'warehouse',
        site_id: siteId,
      },
    });
    await tenantPrisma.inventoryStock.create({
      data: {
        catalog_item_id: catalogItemId,
        site_id: siteId,
        location_id: location.id,
        quantity_on_hand: 50,
      },
    });
  });

  afterAll(async () => {
    await tenantPrisma.creditNoteItem.deleteMany();
    await tenantPrisma.creditNote.deleteMany();
    await tenantPrisma.creditNoteSequence.deleteMany();
    await tenantPrisma.invoiceItem.deleteMany();
    await tenantPrisma.invoice.deleteMany();
    await tenantPrisma.invoiceSequence.deleteMany();
    await tenantPrisma.salesOrderItem.deleteMany();
    await tenantPrisma.salesOrder.deleteMany();
    await teardownTestApp(app, prisma);
  });

  async function finalizeSalesInvoice(quantity = 2, unitPrice = 50) {
    const orderRes = await request(app.getHttpServer())
      .post('/api/sales-orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customer_id: customerId,
        items: [
          {
            catalog_item_id: catalogItemId,
            description: 'Oil Filter',
            quantity,
            unit_price: unitPrice,
            tax_rate: 20,
          },
        ],
      })
      .expect(201);

    await tenantPrisma.salesOrder.updateMany({
      where: { id: orderRes.body.id },
      data: { status: 'CONFIRMED' },
    });

    const invoiceRes = await request(app.getHttpServer())
      .post(`/api/sales-orders/${orderRes.body.id}/create-invoice`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);

    const finalized = await request(app.getHttpServer())
      .put(`/api/sales/invoices/${invoiceRes.body.id}/finalize`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    return finalized.body;
  }

  function createDraftCredit(invoiceId: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(`/api/invoices/${invoiceId}/credit-notes`)
      .set('Authorization', `Bearer ${authToken}`)
      .send(body);
  }

  it('LI-07: assigns independent CN numbers and replays finalize idempotently', async () => {
    const invoice = await finalizeSalesInvoice();

    const draft = await createDraftCredit(invoice.id, {
      date: '2026-09-21',
      reason: 'Customer return',
      mode: 'FULL',
    }).expect(201);

    const first = await request(app.getHttpServer())
      .post(`/api/credit-notes/${draft.body.id}/finalize`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ expectedVersion: 1, idempotencyKey: 'cn-finalize-1' })
      .expect(201);

    expect(first.body.creditNumber).toMatch(/^CN-2026-\d{4}$/);

    const replay = await request(app.getHttpServer())
      .post(`/api/credit-notes/${draft.body.id}/finalize`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ expectedVersion: 1, idempotencyKey: 'cn-finalize-1' })
      .expect(201);

    expect(replay.body.creditNumber).toBe(first.body.creditNumber);

    await request(app.getHttpServer())
      .post(`/api/credit-notes/${draft.body.id}/finalize`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ expectedVersion: 2, idempotencyKey: 'cn-finalize-1' })
      .expect(409);
  });

  it('LI-08: partial credits respect remaining quantity and exact final cents', async () => {
    const invoice = await finalizeSalesInvoice(3, 33.33);

    const firstDraft = await createDraftCredit(invoice.id, {
      date: '2026-09-21',
      reason: 'Partial correction 1',
      mode: 'PARTIAL',
      lines: [{ originalItemId: invoice.items[0].id, quantity: '1.000' }],
    }).expect(201);

    const firstFinal = await request(app.getHttpServer())
      .post(`/api/credit-notes/${firstDraft.body.id}/finalize`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ expectedVersion: 1, idempotencyKey: 'partial-1' })
      .expect(201);

    const secondDraft = await createDraftCredit(invoice.id, {
      date: '2026-09-21',
      reason: 'Partial correction 2',
      mode: 'PARTIAL',
      lines: [{ originalItemId: invoice.items[0].id, quantity: '2.000' }],
    }).expect(201);

    const secondFinal = await request(app.getHttpServer())
      .post(`/api/credit-notes/${secondDraft.body.id}/finalize`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ expectedVersion: 1, idempotencyKey: 'partial-2' })
      .expect(201);

    const invoiceSnapshot = await tenantPrisma.invoice.findFirstOrThrow({
      where: { id: invoice.id },
    });
    const originalGross = (invoiceSnapshot.snapshot as { total_gross: string })
      .total_gross;
    const creditedGross = (
      Number(firstFinal.body.totalGross) + Number(secondFinal.body.totalGross)
    ).toFixed(2);
    expect(creditedGross).toBe(originalGross);

    await createDraftCredit(invoice.id, {
      date: '2026-09-21',
      reason: 'Too much',
      mode: 'PARTIAL',
      lines: [{ originalItemId: invoice.items[0].id, quantity: '0.001' }],
    }).expect(409);
  });

  it('LI-09: rejects credit dates inside locked fiscal period', async () => {
    const invoice = await finalizeSalesInvoice();

    await tenantPrisma.financeSettings.updateMany({
      where: { tenant_id: tenant.tenantId },
      data: { lock_date: new Date('2026-09-20T23:59:59.999Z') },
    });

    await createDraftCredit(invoice.id, {
      date: '2026-09-20',
      reason: 'Locked period attempt',
      mode: 'FULL',
    }).expect(422);

    const openPeriodDraft = await createDraftCredit(invoice.id, {
      date: '2026-09-21',
      reason: 'Open period credit',
      mode: 'FULL',
    }).expect(201);

    await request(app.getHttpServer())
      .post(`/api/credit-notes/${openPeriodDraft.body.id}/finalize`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ expectedVersion: 1, idempotencyKey: 'open-period' })
      .expect(201);
  });

  it('LI-10/LI-11: rejects ineligible originals and leaves inventory unchanged', async () => {
    const finalized = await finalizeSalesInvoice();
    const stockBefore = await tenantPrisma.inventoryStock.findMany({
      where: { site_id: siteId },
    });
    const invoiceBefore = await tenantPrisma.invoice.findFirstOrThrow({
      where: { id: finalized.id },
    });

    const draft = await createDraftCredit(finalized.id, {
      date: '2026-09-22',
      reason: 'Draft void test',
      mode: 'FULL',
    }).expect(201);

    await request(app.getHttpServer())
      .post(`/api/credit-notes/${draft.body.id}/void`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ expectedVersion: 1 })
      .expect(201);

    const voided = await tenantPrisma.creditNote.findFirstOrThrow({
      where: { id: draft.body.id },
    });
    expect(voided.status).toBe('VOID');
    expect(voided.credit_number).toBeNull();

    const stockAfter = await tenantPrisma.inventoryStock.findMany({
      where: { site_id: siteId },
    });
    const invoiceAfter = await tenantPrisma.invoice.findFirstOrThrow({
      where: { id: finalized.id },
    });

    expect(stockAfter).toEqual(stockBefore);
    expect(invoiceAfter.snapshot).toEqual(invoiceBefore.snapshot);
    expect(invoiceAfter.status).toBe(invoiceBefore.status);

    const draftInvoice = await tenantPrisma.invoice.create({
      data: {
        tenant_id: tenant.tenantId,
        customer_id: customerId,
        site_id: siteId,
        legal_entity_id: invoiceBefore.legal_entity_id,
        status: 'DRAFT',
        date: new Date('2026-09-21'),
        due_date: new Date('2026-10-05'),
        total_net: 10,
        total_tax: 2,
        total_gross: 12,
        items: {
          create: {
            tenant_id: tenant.tenantId,
            description: 'Draft only',
            quantity: 1,
            unit_price: 10,
            tax_rate: 20,
            line_total: 10,
          },
        },
      },
      include: { items: true },
    });

    await createDraftCredit(draftInvoice.id, {
      date: '2026-09-22',
      reason: 'Should fail',
      mode: 'FULL',
    }).expect(422);
  });
});
