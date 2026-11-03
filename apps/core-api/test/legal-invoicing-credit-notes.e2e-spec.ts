import { createE2eApp } from './helpers/e2e-suite.js';
import { countDbStatements } from './helpers/db-statement-counter.js';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TenantMemberRole } from '@prisma/client';
import { AuthService } from '../src/auth/auth.service.js';
import { PdfStorage } from '../src/common/pdf/pdf-storage.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SystemPrismaService } from '../src/prisma/system-prisma.service.js';
import {
  createTestAuthToken,
  createTestTenant,
  createTenantAwarePrisma,
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
  let systemPrisma: SystemPrismaService;
  let tenantPrisma: PrismaService;
  let authService: AuthService;
  let tenant: TestTenantResult;
  let authToken: string;
  let siteId: string;
  let customerId: string;
  let catalogItemId: string;
  const createdMemberIds: string[] = [];
  const createdDemoAccessRequestIds: string[] = [];

  beforeAll(async () => {
    app = await createE2eApp();

    prisma = app.get<PrismaService>(PrismaService);
    systemPrisma = app.get(SystemPrismaService);
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
        tenant_id: tenant.tenantId,
        sku: `AUT302-${Date.now()}`,
        name: 'Oil Filter',
        cost_price: 5,
        retail_price: 12,
      },
    });
    catalogItemId = catalogItem.id;

    const location = await tenantPrisma.storageLocation.create({
      data: {
        tenant_id: tenant.tenantId,
        code: `LOC-${Date.now()}`,
        name: 'Warehouse',
        type: 'warehouse',
        site_id: siteId,
      },
    });
    await tenantPrisma.inventoryStock.create({
      data: {
        tenant_id: tenant.tenantId,
        catalog_item_id: catalogItemId,
        site_id: siteId,
        location_id: location.id,
        quantity_on_hand: 500,
      },
    });
  });

  afterAll(async () => {
    if (createdMemberIds.length > 0) {
      await systemPrisma.landingDemoSignInGrant.deleteMany({
        where: { user_id: { in: createdMemberIds } },
      });
    }
    if (createdDemoAccessRequestIds.length > 0) {
      await systemPrisma.landingDemoAccessRequest.deleteMany({
        where: { id: { in: createdDemoAccessRequestIds } },
      });
    }
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

  /** Stable invoice date so credit-note tests can use fixed calendar dates on any CI day. */
  const fixtureInvoiceDate = new Date('2026-09-21T12:00:00.000Z');

  async function finalizeSalesInvoice(
    quantity = 2,
    unitPrice = 50,
    lineCount = 1,
  ) {
    const orderRes = await request(app.getHttpServer())
      .post('/api/sales-orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customer_id: customerId,
        items: Array.from({ length: lineCount }, () => ({
          catalog_item_id: catalogItemId,
          description: 'Oil Filter',
          quantity,
          unit_price: unitPrice,
          tax_rate: 20,
        })),
      })
      .expect(201);

    const invoiceRes = await request(app.getHttpServer())
      .post(`/api/sales-orders/${orderRes.body.id}/create-invoice`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);

    await tenantPrisma.invoice.update({
      where: { id: invoiceRes.body.id },
      data: { date: fixtureInvoiceDate },
    });

    const finalized = await request(app.getHttpServer())
      .put(`/api/sales/invoices/${invoiceRes.body.id}/finalize`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    return finalized.body;
  }

  function createDraftCredit(
    invoiceId: string,
    body: Record<string, unknown>,
    bearer = `Bearer ${authToken}`,
  ) {
    return request(app.getHttpServer())
      .post(`/api/invoices/${invoiceId}/credit-notes`)
      .set('Authorization', bearer)
      .send(body);
  }

  function finalizeCredit(
    creditNoteId: string,
    idempotencyKey: string,
    bearer = `Bearer ${authToken}`,
  ) {
    return request(app.getHttpServer())
      .post(`/api/credit-notes/${creditNoteId}/finalize`)
      .set('Authorization', bearer)
      .send({ expectedVersion: 1, idempotencyKey });
  }

  /**
   * A member of the fixture tenant with `role`, an active MAIN-site membership and that site selected.
   * Site membership is part of the credit-note read scope, so a non-admin caller needs it to reach the
   * role check. `tag` keeps one row per role when several tests need the same role.
   */
  async function siteMemberBearer(
    role: TenantMemberRole,
    tag: string,
  ): Promise<string> {
    const firebaseUid = `aut911-${tag}-${tenant.tenantId}`;
    const email = `aut911-${tag}@example.com`;
    const member = await prisma.user.create({
      data: {
        firebaseUid,
        email,
        active_tenant_id: tenant.tenantId,
        memberships: {
          create: { tenant_id: tenant.tenantId, role, is_active: true },
        },
      },
      select: { id: true },
    });
    createdMemberIds.push(member.id);
    await tenantPrisma.siteMembership.create({
      data: {
        tenant_id: tenant.tenantId,
        user_id: member.id,
        site_id: siteId,
        is_active: true,
      },
    });

    // A DEMO session needs a sign-in grant to reach authorization (403) instead of failing authentication (401).
    if (role === 'DEMO') {
      const accessRequest = await systemPrisma.landingDemoAccessRequest.create({
        data: {
          email,
          name: 'AUT-911 Demo Viewer',
          betrieb: 'E2E',
          consent_recorded_at: new Date(),
        },
        select: { id: true },
      });
      createdDemoAccessRequestIds.push(accessRequest.id);
      await systemPrisma.landingDemoSignInGrant.create({
        data: {
          access_request_id: accessRequest.id,
          user_id: member.id,
          expires_at: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
    }

    const bearer = `Bearer ${createTestAuthToken(authService, {
      ...tenant,
      firebaseUid,
      email,
      role,
    })}`;
    await request(app.getHttpServer())
      .patch('/api/me/active-site')
      .set('Authorization', bearer)
      .send({ siteId })
      .expect(200);

    return bearer;
  }

  afterEach(async () => {
    await tenantPrisma.financeSettings.updateMany({
      where: { tenant_id: tenant.tenantId },
      data: { lock_date: null },
    });
  });

  async function patchInvoiceSnapshotForLowCentLine(invoiceId: string) {
    const invoice = await tenantPrisma.invoice.findFirstOrThrow({
      where: { id: invoiceId },
      include: { items: true },
    });
    const snapshot = invoice.snapshot as Record<string, unknown>;
    const item = (snapshot.items as Array<Record<string, unknown>>)[0];

    const patchedSnapshot = {
      ...snapshot,
      items: [
        {
          ...item,
          quantity: '10.000',
          unit_price: '0.01',
          net: '0.05',
          tax: '0.01',
          gross: '0.06',
        },
      ],
      tax_breakdown: [
        {
          rate:
            typeof item.tax_rate === 'string' || typeof item.tax_rate === 'number'
              ? item.tax_rate
              : String(item.tax_rate),
          net: '0.05',
          tax: '0.01',
          gross: '0.06',
        },
      ],
      total_net: '0.05',
      total_tax: '0.01',
      total_gross: '0.06',
    };

    await tenantPrisma.invoice.update({
      where: { id: invoiceId },
      data: {
        total_net: 0.05,
        total_tax: 0.01,
        total_gross: 0.06,
        snapshot: patchedSnapshot,
      },
    });

    return {
      ...invoice,
      items: invoice.items,
      snapshot: patchedSnapshot,
    };
  }

  async function finalizeCreditStatementsFor(lineCount: number) {
    const invoice = await finalizeSalesInvoice(1, 50, lineCount);
    const draft = await createDraftCredit(invoice.id, {
      date: '2026-09-21',
      reason: 'Statement count',
      mode: 'FULL',
    }).expect(201);
    return countDbStatements(async () => {
      await finalizeCredit(draft.body.id, `count-${lineCount}`).expect(201);
    });
  }

  async function listCreditsStatementsFor(rows: number) {
    const invoice = await finalizeSalesInvoice(rows, 50);
    for (let index = 0; index < rows; index += 1) {
      await createDraftCredit(invoice.id, {
        date: '2026-09-21',
        reason: `Row ${index + 1}`,
        mode: 'PARTIAL',
        lines: [{ originalItemId: invoice.items[0].id, quantity: '1.000' }],
      }).expect(201);
    }
    return countDbStatements(async () => {
      await request(app.getHttpServer())
        .get(`/api/credit-notes?originalInvoiceId=${invoice.id}&limit=${rows}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
    });
  }

  it.each([
    ['finalize', finalizeCreditStatementsFor],
    ['list', listCreditsStatementsFor],
  ])(
    'AUT-860 S1: credit note %s sends the same number of SQL statements for 2 and 10 lines or rows',
    async (_flow, statementsFor) => {
      const twoLines = await statementsFor(2);
      const tenLines = await statementsFor(10);

      expect(tenLines).toBe(twoLines);
    },
  );

  it('LI-07: assigns independent CN numbers and replays finalize idempotently', async () => {
    const invoice = await finalizeSalesInvoice();

    const draft = await createDraftCredit(invoice.id, {
      date: '2026-09-21',
      reason: 'Customer return',
      mode: 'FULL',
    }).expect(201);

    const first = await finalizeCredit(draft.body.id, 'cn-finalize-1').expect(201);

    expect(first.body.creditNumber).toMatch(/^CN-2026-\d{4}$/);

    const replay = await finalizeCredit(draft.body.id, 'cn-finalize-1').expect(201);

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

    const firstFinal = await finalizeCredit(firstDraft.body.id, 'partial-1').expect(
      201,
    );

    const secondDraft = await createDraftCredit(invoice.id, {
      date: '2026-09-21',
      reason: 'Partial correction 2',
      mode: 'PARTIAL',
      lines: [{ originalItemId: invoice.items[0].id, quantity: '2.000' }],
    }).expect(201);

    const secondFinal = await finalizeCredit(secondDraft.body.id, 'partial-2').expect(
      201,
    );

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

  it('LI-08: sequential penny partials never exceed remaining net', async () => {
    const invoice = await finalizeSalesInvoice(10, 0.01);
    const patched = await patchInvoiceSnapshotForLowCentLine(invoice.id);
    const lineId = patched.items[0].id;

    let creditedNet = 0;
    for (let index = 0; index < 5; index += 1) {
      const draft = await createDraftCredit(invoice.id, {
        date: '2026-09-21',
        reason: `Penny partial ${index + 1}`,
        mode: 'PARTIAL',
        lines: [{ originalItemId: lineId, quantity: '1.000' }],
      }).expect(201);

      const finalized = await finalizeCredit(
        draft.body.id,
        `penny-partial-${index}`,
      ).expect(201);

      expect(
        Number(finalized.body.items[0].snapshot.net) +
          Number(finalized.body.items[0].snapshot.tax),
      ).toBeCloseTo(Number(finalized.body.items[0].snapshot.gross), 2);
      creditedNet += Number(finalized.body.items[0].snapshot.net);
    }

    expect(creditedNet).toBeLessThanOrEqual(0.05);
    expect(creditedNet.toFixed(2)).toBe('0.05');

    await createDraftCredit(invoice.id, {
      date: '2026-09-21',
      reason: 'Money depleted',
      mode: 'PARTIAL',
      lines: [{ originalItemId: lineId, quantity: '1.000' }],
    }).expect(409);
  });

  it('LI-08: racing partial finalize rejects the second credit', async () => {
    const invoice = await finalizeSalesInvoice(3, 50);
    const invoiceSnapshot = await tenantPrisma.invoice.findFirstOrThrow({
      where: { id: invoice.id },
    });
    const originalGross = Number(
      (invoiceSnapshot.snapshot as { total_gross: string }).total_gross,
    );

    const firstDraft = await createDraftCredit(invoice.id, {
      date: '2026-09-21',
      reason: 'Race partial 1',
      mode: 'PARTIAL',
      lines: [{ originalItemId: invoice.items[0].id, quantity: '2.000' }],
    }).expect(201);

    const secondDraft = await createDraftCredit(invoice.id, {
      date: '2026-09-21',
      reason: 'Race partial 2',
      mode: 'PARTIAL',
      lines: [{ originalItemId: invoice.items[0].id, quantity: '2.000' }],
    }).expect(201);

    const [firstResult, secondResult] = await Promise.all([
      finalizeCredit(firstDraft.body.id, 'race-partial-1'),
      finalizeCredit(secondDraft.body.id, 'race-partial-2'),
    ]);

    const statuses = [firstResult.status, secondResult.status].sort();
    expect(statuses).toEqual([201, 409]);

    const failed = firstResult.status === 409 ? firstResult : secondResult;
    expect(failed.body.code).toBe('CREDIT_LIMIT_EXCEEDED');

    const succeeded = firstResult.status === 201 ? firstResult : secondResult;
    expect(Number(succeeded.body.totalGross)).toBeLessThanOrEqual(originalGross);
  });

  it('LI-09: rejects credit dates inside locked fiscal period', async () => {
    const invoice = await finalizeSalesInvoice();

    await tenantPrisma.financeSettings.updateMany({
      where: { tenant_id: tenant.tenantId },
      data: { lock_date: new Date('2026-09-21T23:59:59.999Z') },
    });

    try {
      const locked = await createDraftCredit(invoice.id, {
        date: '2026-09-21',
        reason: 'Locked period attempt',
        mode: 'FULL',
      }).expect(422);

      expect(locked.body.code).toBe('FISCAL_PERIOD_LOCKED');

      const openPeriodDraft = await createDraftCredit(invoice.id, {
        date: '2026-09-22',
        reason: 'Open period credit',
        mode: 'FULL',
      }).expect(201);

      await finalizeCredit(openPeriodDraft.body.id, 'open-period').expect(201);
    } finally {
      await tenantPrisma.financeSettings.updateMany({
        where: { tenant_id: tenant.tenantId },
        data: { lock_date: null },
      });
    }
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

  it('LI-10: allows credits against PAID originals', async () => {
    const invoice = await finalizeSalesInvoice();

    await tenantPrisma.invoice.updateMany({
      where: { id: invoice.id },
      data: { status: 'PAID' },
    });

    const draft = await createDraftCredit(invoice.id, {
      date: '2026-09-22',
      reason: 'Paid invoice correction',
      mode: 'FULL',
    }).expect(201);

    await finalizeCredit(draft.body.id, 'paid-original').expect(201);
  });

  it('LI-10: rejects legacy v1 snapshots and foreign lines', async () => {
    const invoice = await finalizeSalesInvoice();
    const invoiceRecord = await tenantPrisma.invoice.findFirstOrThrow({
      where: { id: invoice.id },
    });

    const legacyInvoice = await tenantPrisma.invoice.create({
      data: {
        tenant_id: tenant.tenantId,
        customer_id: customerId,
        site_id: siteId,
        legal_entity_id: invoiceRecord.legal_entity_id,
        status: 'FINALIZED',
        invoice_number: 'LEG-001',
        date: new Date('2026-09-21'),
        due_date: new Date('2026-10-05'),
        total_net: 10,
        total_tax: 2,
        total_gross: 12,
        snapshot: { schema_version: 1, total_gross: '12.00' },
        items: {
          create: {
            tenant_id: tenant.tenantId,
            description: 'Legacy line',
            quantity: 1,
            unit_price: 10,
            tax_rate: 20,
            line_total: 10,
          },
        },
      },
      include: { items: true },
    });

    const legacyResponse = await createDraftCredit(legacyInvoice.id, {
      date: '2026-09-22',
      reason: 'Legacy unsupported',
      mode: 'FULL',
    }).expect(422);

    expect(legacyResponse.body.code).toBe('LEGACY_DOCUMENT_UNSUPPORTED');

    const foreignLine = await createDraftCredit(invoice.id, {
      date: '2026-09-22',
      reason: 'Foreign line',
      mode: 'PARTIAL',
      lines: [{ originalItemId: randomUUID(), quantity: '1.000' }],
    }).expect(400);

    expect(foreignLine.body.message).toContain(
      'Credit line does not belong to the original invoice.',
    );

    const negativeQty = await createDraftCredit(invoice.id, {
      date: '2026-09-22',
      reason: 'Negative qty',
      mode: 'PARTIAL',
      lines: [{ originalItemId: invoice.items[0].id, quantity: '-1.000' }],
    }).expect(400);

    expect(negativeQty.body.message).toContain(
      'Credit quantity must be greater than zero.',
    );

    const zeroQty = await createDraftCredit(invoice.id, {
      date: '2026-09-22',
      reason: 'Zero qty',
      mode: 'PARTIAL',
      lines: [{ originalItemId: invoice.items[0].id, quantity: '0.000' }],
    }).expect(400);

    expect(zeroQty.body.message).toContain(
      'Credit quantity must be greater than zero.',
    );
  });

  it('AUT-911: a SALES member with site membership reads the credit-note list', async () => {
    const invoice = await finalizeSalesInvoice();
    const draft = await createDraftCredit(invoice.id, {
      date: '2026-09-22',
      reason: 'SALES reads the list',
      mode: 'FULL',
    }).expect(201);

    const salesBearer = await siteMemberBearer('SALES', 'list');
    const listRes = await request(app.getHttpServer())
      .get('/api/credit-notes')
      .set('Authorization', salesBearer)
      .expect(200);

    const listedIds: string[] = listRes.body.data.map(
      (row: { id: string }) => row.id,
    );
    expect(listedIds).toContain(draft.body.id);
    expect(listRes.body.meta).toEqual(
      expect.objectContaining({ page: 1, pageSize: 25 }),
    );

    const detailRes = await request(app.getHttpServer())
      .get(`/api/credit-notes/${draft.body.id}`)
      .set('Authorization', salesBearer)
      .expect(200);
    expect(detailRes.body.id).toBe(draft.body.id);

    const invoiceContextRes = await request(app.getHttpServer())
      .get(`/api/invoices/${invoice.id}/credit-notes`)
      .set('Authorization', salesBearer)
      .expect(200);
    expect(
      invoiceContextRes.body.creditNotes.map((row: { id: string }) => row.id),
    ).toContain(draft.body.id);
  });

  it.each(['TECH', 'DEMO'] as const)(
    'AUT-911: a %s member is refused GET /api/credit-notes with 403',
    async (role) => {
      const bearer = await siteMemberBearer(role, role.toLowerCase());

      await request(app.getHttpServer())
        .get('/api/credit-notes')
        .set('Authorization', bearer)
        .expect(403);
    },
  );

  it('AUT-911: a SALES member reads a credit note PDF with 200', async () => {
    const invoice = await finalizeSalesInvoice();
    const draft = await createDraftCredit(invoice.id, {
      date: '2026-09-22',
      reason: 'SALES reads the PDF',
      mode: 'FULL',
    }).expect(201);
    await finalizeCredit(draft.body.id, 'aut911-sales-pdf').expect(201);

    const pdfBytes = Buffer.from('%PDF-1.4 credit note read fixture\n%%EOF');
    const expectedKey = `credit-notes/${draft.body.id}.pdf`;
    const openPdf = jest
      .spyOn(app.get(PdfStorage), 'getPdfStream')
      .mockImplementation(async () => ({
        bucket: 'e2e-credit-note-pdf',
        key: expectedKey,
        stream: Readable.from(pdfBytes),
        contentType: 'application/pdf',
        contentLength: pdfBytes.byteLength,
      }));

    const salesBearer = await siteMemberBearer('SALES', 'pdf');
    try {
      const pdfRes = await request(app.getHttpServer())
        .get(`/api/credit-notes/${draft.body.id}/pdf`)
        .set('Authorization', salesBearer)
        .expect(200);

      expect(pdfRes.headers['content-type']).toContain('application/pdf');
      expect(openPdf).toHaveBeenCalledWith(
        expect.objectContaining({ key: expectedKey }),
      );
    } finally {
      openPdf.mockRestore();
    }
  });

  it.each(['create from invoice', 'finalize'] as const)(
    'AUT-911: a SALES member is refused %s with 403',
    async (operation) => {
      const invoice = await finalizeSalesInvoice();
      const draft = await createDraftCredit(invoice.id, {
        date: '2026-09-22',
        reason: 'Admin draft, SALES may not change it',
        mode: 'FULL',
      }).expect(201);
      const salesBearer = await siteMemberBearer(
        'SALES',
        `write-${operation.split(' ').join('-')}`,
      );

      const attempts: Record<typeof operation, { path: string; body: object }> = {
        finalize: {
          path: `/api/credit-notes/${draft.body.id}/finalize`,
          body: { expectedVersion: 1, idempotencyKey: randomUUID() },
        },
        'create from invoice': {
          path: `/api/invoices/${invoice.id}/credit-notes`,
          body: { date: '2026-09-23', reason: 'SALES attempt', mode: 'FULL' },
        },
      };
      const attempt = attempts[operation];

      await request(app.getHttpServer())
        .post(attempt.path)
        .set('Authorization', salesBearer)
        .send(attempt.body)
        .expect(403);

      const untouched = await tenantPrisma.creditNote.findMany({
        where: { original_invoice_id: invoice.id },
        select: { id: true, status: true },
      });
      expect(untouched).toEqual([{ id: draft.body.id, status: 'DRAFT' }]);
    },
  );

  it('AUT-911: a SALES member is refused generate pdf with 403', async () => {
    const invoice = await finalizeSalesInvoice();
    const draft = await createDraftCredit(invoice.id, {
      date: '2026-09-22',
      reason: 'Finalized, SALES may not regenerate the PDF',
      mode: 'FULL',
    }).expect(201);
    await finalizeCredit(draft.body.id, 'aut911-sales-generate').expect(201);

    // The note is FINALIZED and on the SALES member's site, so the status gate that
    // answers 400 for drafts and the site check would both pass for OWNER/ADMIN. Only
    // the OWNER/ADMIN role gate on PDF generation can refuse this caller, with 403.
    const salesBearer = await siteMemberBearer('SALES', 'write-generate-pdf');
    await request(app.getHttpServer())
      .post(`/api/credit-notes/${draft.body.id}/pdf`)
      .set('Authorization', salesBearer)
      .send({})
      .expect(403);

    const unchanged = await tenantPrisma.creditNote.findFirstOrThrow({
      where: { id: draft.body.id },
      select: { status: true, pdf_generated_at: true },
    });
    expect(unchanged.status).toBe('FINALIZED');
    expect(unchanged.pdf_generated_at).toBeNull();
  });

  it('LI-11: rejects margin partial updates and finalized mutations', async () => {
    const invoice = await finalizeSalesInvoice();
    const invoiceRecord = await tenantPrisma.invoice.findFirstOrThrow({
      where: { id: invoice.id },
    });
    const snapshot = invoiceRecord.snapshot as Record<string, unknown>;

    await tenantPrisma.invoice.update({
      where: { id: invoice.id },
      data: {
        snapshot: {
          ...snapshot,
          tax_mode: 'MARGIN_SCHEME',
          margin: {
            cost_basis: '80.00',
            margin_tax: '4.00',
            tax_rate: '20.00',
            calculation_profile: 'vehicle-margin-v1',
          },
        },
      },
    });

    const draft = await createDraftCredit(invoice.id, {
      date: '2026-09-22',
      reason: 'Margin full draft',
      mode: 'FULL',
    }).expect(201);

    const partialPatch = await request(app.getHttpServer())
      .patch(`/api/credit-notes/${draft.body.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expectedVersion: 1,
        lines: [
          {
            originalItemId: invoice.items[0].id,
            quantity: '1.000',
          },
        ],
      })
      .expect(422);

    expect(partialPatch.body.code).toBe('UNSUPPORTED_TAX_PROFILE');

    const finalizedDraft = await createDraftCredit(invoice.id, {
      date: '2026-09-22',
      reason: 'Finalize mutation guard',
      mode: 'FULL',
    }).expect(201);

    await finalizeCredit(finalizedDraft.body.id, 'finalized-mutation').expect(201);

    await request(app.getHttpServer())
      .patch(`/api/credit-notes/${finalizedDraft.body.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ expectedVersion: 2, reason: 'Too late' })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/api/credit-notes/${finalizedDraft.body.id}/void`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ expectedVersion: 2 })
      .expect(409);
  });

  it('LI-11: finalized credits leave inventory unchanged and preserve unit price', async () => {
    const invoice = await finalizeSalesInvoice();
    const stockBefore = await tenantPrisma.inventoryStock.findMany({
      where: { site_id: siteId },
    });
    const originalSnapshot = (
      await tenantPrisma.invoice.findFirstOrThrow({ where: { id: invoice.id } })
    ).snapshot as { items: Array<{ unit_price: string }> };

    const draft = await createDraftCredit(invoice.id, {
      date: '2026-09-22',
      reason: 'Inventory neutral credit',
      mode: 'FULL',
    }).expect(201);

    const finalized = await finalizeCredit(
      draft.body.id,
      'inventory-neutral',
    ).expect(201);

    const stockAfter = await tenantPrisma.inventoryStock.findMany({
      where: { site_id: siteId },
    });
    expect(stockAfter).toEqual(stockBefore);

    expect(finalized.body.items[0].snapshot.unit_price).toBe(
      originalSnapshot.items[0].unit_price,
    );
    expect(finalized.body.items[0].snapshot.line_discount_type).toBeDefined();
  });
});
