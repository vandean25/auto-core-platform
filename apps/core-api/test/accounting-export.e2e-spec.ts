import { createHash, randomUUID } from 'node:crypto';
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
  closeFinancePeriod,
  seedDeAccountingExportProfile,
} from './accounting-export-test-utils.js';
import {
  seedInvoiceReadyCustomer,
  seedReadySellerAndAccountingProfile,
} from './invoice-snapshot-v2-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';
import { decodeDatevCsv } from '../src/finance/accounting-export/datev-csv.util.js';
import {
  DATEV_BUCHUNGSSTAPEL_COLUMN_COUNT,
} from '../src/finance/accounting-export/datev-format.constants.js';

describe('Accounting export (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: PrismaService;
  let authService: AuthService;
  let tenantA: TestTenantResult;
  let tenantB: TestTenantResult;
  let authTokenA: string;
  let authTokenB: string;
  let deEntityId: string;
  let deSiteId: string;
  let atSiteId: string;
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

    tenantA = await createTestTenant(prisma, 'aut307a');
    tenantB = await createTestTenant(prisma, 'aut307b');
    tenantPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
    authTokenA = createTestAuthToken(authService, tenantA);
    authTokenB = createTestAuthToken(authService, tenantB);
    atSiteId = await resolveTestMainSiteId(prisma, tenantA.tenantId);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "accounting_exports",
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

    const deEntity = await tenantPrisma.legalEntity.create({
      data: {
        tenant_id: tenantA.tenantId,
        name: 'Berlin Motors GmbH',
        country_iso: 'DE',
        is_active: true,
        address_street: 'Friedrichstraße 10',
        address_zip: '10117',
        address_city: 'Berlin',
        tax_number: '27/010/12345',
        payment_terms_days: 14,
        payment_terms_text: 'Zahlbar innerhalb von 14 Tagen.',
      },
    });
    deEntityId = deEntity.id;

    const deSite = await tenantPrisma.site.create({
      data: {
        tenant_id: tenantA.tenantId,
        legal_entity_id: deEntityId,
        code: 'DE-BER',
        name: 'Berlin Branch',
        timezone: 'Europe/Berlin',
        holiday_country_iso: 'DE',
        is_active: true,
      },
    });
    deSiteId = deSite.id;

    const user = await prisma.user.findFirstOrThrow({
      where: { firebaseUid: tenantA.firebaseUid },
      select: { id: true },
    });
    await tenantPrisma.siteMembership.create({
      data: {
        tenant_id: tenantA.tenantId,
        user_id: user.id,
        site_id: deSiteId,
        is_active: true,
      },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { active_site_id: deSiteId },
    });

    await seedDeAccountingExportProfile(prisma, tenantA.tenantId, deEntityId, {
      isEnabled: true,
    });
    await seedReadySellerAndAccountingProfile(prisma, tenantA.tenantId);

    const customer = await seedInvoiceReadyCustomer(prisma, tenantA.tenantId);
    customerId = customer.id;

    const catalogItem = await tenantPrisma.catalogItem.create({
      data: {
        sku: `AUT307-${Date.now()}`,
        name: 'Brake Disc',
        cost_price: 20,
        retail_price: 40,
      },
    });
    catalogItemId = catalogItem.id;

    const location = await tenantPrisma.storageLocation.create({
      data: {
        code: `LOC-${Date.now()}`,
        name: 'Warehouse',
        type: 'warehouse',
        site_id: deSiteId,
      },
    });
    await tenantPrisma.inventoryStock.create({
      data: {
        catalog_item_id: catalogItemId,
        site_id: deSiteId,
        location_id: location.id,
        quantity_on_hand: 100,
      },
    });

    await openFinancePeriod();
  });

  afterAll(async () => {
    await tenantPrisma.accountingExport.deleteMany();
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

  async function finalizeSalesInvoice(
    quantity = 1,
    unitPrice = 100,
    invoiceDate = '2026-01-15',
  ) {
    const orderRes = await request(app.getHttpServer())
      .post('/api/sales-orders')
      .set('Authorization', `Bearer ${authTokenA}`)
      .send({
        customer_id: customerId,
        items: [
          {
            catalog_item_id: catalogItemId,
            description: 'Brake Disc',
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
      .set('Authorization', `Bearer ${authTokenA}`)
      .expect(201);

    await tenantPrisma.invoice.updateMany({
      where: { id: invoiceRes.body.id },
      data: { date: new Date(`${invoiceDate}T12:00:00.000Z`) },
    });

    const finalized = await request(app.getHttpServer())
      .put(`/api/sales/invoices/${invoiceRes.body.id}/finalize`)
      .set('Authorization', `Bearer ${authTokenA}`);

    if (finalized.status !== 200) {
      throw new Error(
        `Invoice finalize failed (${finalized.status}): ${JSON.stringify(finalized.body)}`,
      );
    }

    return finalized.body;
  }

  function previewExport(body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/api/finance/accounting-exports/preview')
      .set('Authorization', `Bearer ${authTokenA}`)
      .send(body);
  }

  async function openFinancePeriod() {
    const currentYear = new Date().getFullYear();
    await tenantPrisma.financeSettings.upsert({
      where: { tenant_id: tenantA.tenantId },
      update: { lock_date: null },
      create: {
        tenant_id: tenantA.tenantId,
        fiscal_year_start_month: 1,
        lock_date: null,
        next_invoice_number: 1001,
        invoice_prefix: `RE-${currentYear}-`,
        next_sales_order_number: 1001,
        sales_order_prefix: `SO-${currentYear}-`,
        next_workshop_order_number: 1,
        workshop_order_prefix: `WO-${currentYear}-`,
      },
    });
  }

  it('EX-01: exports one legal entity separately and blocks cross-tenant access', async () => {
    await closeFinancePeriod(prisma, tenantA.tenantId, '2026-01-31');

    const preview = await previewExport({
      legalEntityId: deEntityId,
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
    }).expect(200);

    expect(preview.body.legalEntityId).toBe(deEntityId);
    expect(preview.body.blockers).toEqual([]);

    await request(app.getHttpServer())
      .post('/api/finance/accounting-exports/preview')
      .set('Authorization', `Bearer ${authTokenB}`)
      .send({
        legalEntityId: deEntityId,
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
      })
      .expect(404);
  });

  it('EX-02: rejects open periods and accepts inclusive closed ranges', async () => {
    await openFinancePeriod();

    await previewExport({
      legalEntityId: deEntityId,
      dateFrom: '2026-02-01',
      dateTo: '2026-02-28',
    }).expect(422);

    const invoice = await finalizeSalesInvoice(1, 100, '2026-02-15');
    await closeFinancePeriod(prisma, tenantA.tenantId, '2026-02-28');
    const preview = await previewExport({
      legalEntityId: deEntityId,
      dateFrom: '2026-02-01',
      dateTo: '2026-02-28',
    }).expect(200);

    expect(preview.body.documentCount).toBeGreaterThanOrEqual(1);
    expect(
      preview.body.blockers.some(
        (blocker: { documentId?: string }) => blocker.documentId === invoice.id,
      ),
    ).toBe(false);
  });

  it('EX-03/EX-04/EX-07/EX-10: generates immutable replayable export from frozen lines', async () => {
    await openFinancePeriod();
    const invoice = await finalizeSalesInvoice(1, 100, '2026-03-10');
    await closeFinancePeriod(prisma, tenantA.tenantId, '2026-03-31');
    const preview = await previewExport({
      legalEntityId: deEntityId,
      dateFrom: '2026-03-01',
      dateTo: '2026-03-31',
    }).expect(200);

    const idempotencyKey = `export-${randomUUID()}`;
    const generated = await request(app.getHttpServer())
      .post('/api/finance/accounting-exports')
      .set('Authorization', `Bearer ${authTokenA}`)
      .send({
        legalEntityId: deEntityId,
        dateFrom: '2026-03-01',
        dateTo: '2026-03-31',
        previewHash: preview.body.previewHash,
        profileVersion: preview.body.profileVersion,
        idempotencyKey,
        acknowledgeOverlap: true,
      })
      .expect(201);

    const replay = await request(app.getHttpServer())
      .post('/api/finance/accounting-exports')
      .set('Authorization', `Bearer ${authTokenA}`)
      .send({
        legalEntityId: deEntityId,
        dateFrom: '2026-03-01',
        dateTo: '2026-03-31',
        previewHash: preview.body.previewHash,
        profileVersion: preview.body.profileVersion,
        idempotencyKey,
        acknowledgeOverlap: true,
      })
      .expect(201);

    expect(replay.body.id).toBe(generated.body.id);
    expect(replay.body.sha256).toBe(generated.body.sha256);

    const download = await request(app.getHttpServer())
      .get(`/api/finance/accounting-exports/${generated.body.id}/download`)
      .set('Authorization', `Bearer ${authTokenA}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    const csv = decodeDatevCsv(download.body as Buffer);
    expect(csv).toContain(invoice.invoice_number);
    expect(csv.split('\r\n')[1].split(';')).toHaveLength(
      DATEV_BUCHUNGSSTAPEL_COLUMN_COUNT,
    );
    expect(
      createHash('sha256').update(download.body as Buffer).digest('hex'),
    ).toBe(generated.body.sha256);

    await tenantPrisma.invoice.updateMany({
      where: { id: invoice.id },
      data: { status: 'PAID' },
    });

    const previewAfterPaid = await previewExport({
      legalEntityId: deEntityId,
      dateFrom: '2026-03-01',
      dateTo: '2026-03-31',
    }).expect(200);

    expect(previewAfterPaid.body.rowCount).toBe(preview.body.rowCount);
  });

  it('EX-08: rejects empty periods and disabled profiles', async () => {
    await openFinancePeriod();
    await closeFinancePeriod(prisma, tenantA.tenantId, '2026-04-30');

    const emptyPreview = await previewExport({
      legalEntityId: deEntityId,
      dateFrom: '2026-04-01',
      dateTo: '2026-04-30',
    }).expect(200);

    expect(emptyPreview.body.documentCount).toBe(0);
    expect(emptyPreview.body.canGenerate).toBe(false);

    await request(app.getHttpServer())
      .post('/api/finance/accounting-exports')
      .set('Authorization', `Bearer ${authTokenA}`)
      .send({
        legalEntityId: deEntityId,
        dateFrom: '2026-04-01',
        dateTo: '2026-04-30',
        previewHash: emptyPreview.body.previewHash,
        profileVersion: emptyPreview.body.profileVersion,
        idempotencyKey: `empty-${randomUUID()}`,
      })
      .expect(422);

    await tenantPrisma.legalEntityAccountingProfile.updateMany({
      where: {
        tenant_id: tenantA.tenantId,
        legal_entity_id: deEntityId,
      },
      data: { is_enabled: false },
    });

    const disabledPreview = await previewExport({
      legalEntityId: deEntityId,
      dateFrom: '2026-03-01',
      dateTo: '2026-03-31',
    }).expect(200);

    expect(disabledPreview.body.canGenerate).toBe(false);

    await tenantPrisma.legalEntityAccountingProfile.updateMany({
      where: {
        tenant_id: tenantA.tenantId,
        legal_entity_id: deEntityId,
      },
      data: { is_enabled: true },
    });
  });

  it('EX-04: blocks legacy cancelled invoices for the whole run', async () => {
    await openFinancePeriod();
    const invoice = await finalizeSalesInvoice(1, 50, '2026-05-10');
    await closeFinancePeriod(prisma, tenantA.tenantId, '2026-05-31');

    await tenantPrisma.invoice.updateMany({
      where: { id: invoice.id },
      data: { status: 'CANCELLED' },
    });

    const preview = await previewExport({
      legalEntityId: deEntityId,
      dateFrom: '2026-05-01',
      dateTo: '2026-05-31',
    }).expect(200);

    expect(
      preview.body.blockers.some(
        (blocker: { code: string }) => blocker.code === 'CANCELLED_DOCUMENT',
      ),
    ).toBe(true);
    expect(preview.body.canGenerate).toBe(false);
  });

  it('EX-09: rejects stale preview hash on generation', async () => {
    await openFinancePeriod();
    await finalizeSalesInvoice(1, 75, '2026-06-12');
    await closeFinancePeriod(prisma, tenantA.tenantId, '2026-06-30');

    const preview = await previewExport({
      legalEntityId: deEntityId,
      dateFrom: '2026-06-01',
      dateTo: '2026-06-30',
    }).expect(200);

    await request(app.getHttpServer())
      .post('/api/finance/accounting-exports')
      .set('Authorization', `Bearer ${authTokenA}`)
      .send({
        legalEntityId: deEntityId,
        dateFrom: '2026-06-01',
        dateTo: '2026-06-30',
        previewHash: 'stale-preview-hash-value',
        profileVersion: preview.body.profileVersion,
        idempotencyKey: `stale-${randomUUID()}`,
      })
      .expect(409);
  });
});
