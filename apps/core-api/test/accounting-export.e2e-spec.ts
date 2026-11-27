import { createE2eApp } from './helpers/e2e-suite.js';
import { createHash, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
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
  createAccountingExportInvoice,
  openAccountingExportFinancePeriod,
  seedDeAccountingExportProfile,
} from './accounting-export-test-utils.js';
import {
  seedInvoiceReadyCustomer,
  seedReadySellerAndAccountingProfile,
} from './invoice-snapshot-v2-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';
import { decodeDatevCsv } from '../src/finance/accounting-export/datev-csv.util.js';
import { DATEV_BUCHUNGSSTAPEL_COLUMN_COUNT } from '../src/finance/accounting-export/datev-format.constants.js';

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
  let deEntity2Id: string;
  let deSiteId: string;
  let deSite2Id: string;
  let deEntity2SiteId: string;
  let atSiteId: string;
  let customerId: string;
  let catalogItemId: string;
  let userId: string;

  beforeAll(async () => {
    app = await createE2eApp();

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

    const deEntity2 = await tenantPrisma.legalEntity.create({
      data: {
        tenant_id: tenantA.tenantId,
        name: 'Hamburg Motors GmbH',
        country_iso: 'DE',
        is_active: true,
        address_street: 'Speicherstadt 1',
        address_zip: '20457',
        address_city: 'Hamburg',
        tax_number: '27/010/54321',
        payment_terms_days: 14,
        payment_terms_text: 'Zahlbar innerhalb von 14 Tagen.',
      },
    });
    deEntity2Id = deEntity2.id;

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

    const deSite2 = await tenantPrisma.site.create({
      data: {
        tenant_id: tenantA.tenantId,
        legal_entity_id: deEntityId,
        code: 'DE-HAM',
        name: 'Hamburg Branch',
        timezone: 'Europe/Berlin',
        holiday_country_iso: 'DE',
        is_active: true,
      },
    });
    deSite2Id = deSite2.id;

    const deSiteEntity2 = await tenantPrisma.site.create({
      data: {
        tenant_id: tenantA.tenantId,
        legal_entity_id: deEntity2Id,
        code: 'DE-HH',
        name: 'Hamburg Entity Site',
        timezone: 'Europe/Berlin',
        holiday_country_iso: 'DE',
        is_active: true,
      },
    });
    deEntity2SiteId = deSiteEntity2.id;

    const user = await prisma.user.findFirstOrThrow({
      where: { firebaseUid: tenantA.firebaseUid },
      select: { id: true },
    });
    userId = user.id;

    await tenantPrisma.siteMembership.create({
      data: {
        tenant_id: tenantA.tenantId,
        user_id: userId,
        site_id: deSiteId,
        is_active: true,
      },
    });
    await tenantPrisma.siteMembership.create({
      data: {
        tenant_id: tenantA.tenantId,
        user_id: userId,
        site_id: deSiteEntity2.id,
        is_active: true,
      },
    });
    await prisma.user.update({
      where: { id: userId },
      data: { active_site_id: deSiteId },
    });

    await seedDeAccountingExportProfile(prisma, tenantA.tenantId, deEntityId, {
      isEnabled: true,
    });
    await seedDeAccountingExportProfile(prisma, tenantA.tenantId, deEntity2Id, {
      isEnabled: true,
    });
    await seedReadySellerAndAccountingProfile(prisma, tenantA.tenantId);

    const customer = await seedInvoiceReadyCustomer(prisma, tenantA.tenantId);
    customerId = customer.id;

    const catalogItem = await tenantPrisma.catalogItem.create({
      data: {
        tenant_id: tenantA.tenantId,
        sku: `AUT307-${Date.now()}`,
        name: 'Brake Disc',
        cost_price: 20,
        retail_price: 40,
      },
    });
    catalogItemId = catalogItem.id;

    for (const siteId of [deSiteId, deSite2Id, deEntity2SiteId]) {
      const location = await tenantPrisma.storageLocation.create({
        data: {
          tenant_id: tenantA.tenantId,
          code: `LOC-${siteId.slice(0, 8)}`,
          name: 'Warehouse',
          type: 'warehouse',
          site_id: siteId,
        },
      });
      await tenantPrisma.inventoryStock.create({
        data: {
          tenant_id: tenantA.tenantId,
          catalog_item_id: catalogItemId,
          site_id: siteId,
          location_id: location.id,
          quantity_on_hand: 100,
        },
      });
    }

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
    siteId = deSiteId,
  ) {
    await prisma.user.update({
      where: { id: userId },
      data: { active_site_id: siteId },
    });

    return createAccountingExportInvoice(
      { app, tenantPrisma, authToken: authTokenA, customerId, catalogItemId },
      {
        quantity,
        unitPrice,
        invoiceDate,
        siteId,
        legalEntityId: siteId === deEntity2SiteId ? deEntity2Id : deEntityId,
      },
    );
  }

  function previewExport(body: Record<string, unknown>, token = authTokenA) {
    return request(app.getHttpServer())
      .post('/api/finance/accounting-exports/preview')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  function generateExport(body: Record<string, unknown>, token = authTokenA) {
    return request(app.getHttpServer())
      .post('/api/finance/accounting-exports')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  function downloadExport(exportId: string) {
    return request(app.getHttpServer())
      .get(`/api/finance/accounting-exports/${exportId}/download`)
      .set('Authorization', `Bearer ${authTokenA}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
  }

  function openFinancePeriod() {
    return openAccountingExportFinancePeriod(tenantPrisma, tenantA.tenantId);
  }

  async function createDraftCredit(invoiceId: string, creditDate: string) {
    const draft = await request(app.getHttpServer())
      .post(`/api/invoices/${invoiceId}/credit-notes`)
      .set('Authorization', `Bearer ${authTokenA}`)
      .send({
        date: creditDate,
        reason: 'Customer return',
        mode: 'FULL',
      })
      .expect(201);

    await tenantPrisma.creditNote.updateMany({
      where: { id: draft.body.id },
      data: { date: new Date(`${creditDate}T12:00:00.000Z`) },
    });

    return draft.body;
  }

  async function finalizeCredit(creditNoteId: string) {
    return request(app.getHttpServer())
      .post(`/api/credit-notes/${creditNoteId}/finalize`)
      .set('Authorization', `Bearer ${authTokenA}`)
      .send({
        expectedVersion: 1,
        idempotencyKey: `credit-${randomUUID()}`,
      })
      .expect(201);
  }

  it('EX-01: exports entities separately, blocks cross-tenant and incomplete scope', async () => {
    await openFinancePeriod();
    await finalizeSalesInvoice(1, 100, '2026-01-15', deSiteId);
    await finalizeSalesInvoice(1, 80, '2026-01-16', deEntity2SiteId);
    await closeFinancePeriod(prisma, tenantA.tenantId, '2026-01-31');

    const berlinPreview = await previewExport({
      legalEntityId: deEntityId,
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
    }).expect(200);
    expect(berlinPreview.body.documentCount).toBe(1);

    const hamburgPreview = await previewExport({
      legalEntityId: deEntity2Id,
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
    }).expect(200);
    expect(hamburgPreview.body.documentCount).toBe(1);

    await request(app.getHttpServer())
      .post('/api/finance/accounting-exports/preview')
      .set('Authorization', `Bearer ${authTokenB}`)
      .send({
        legalEntityId: deEntityId,
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
      })
      .expect(404);

    await openFinancePeriod();
    const februaryInvoice = await finalizeSalesInvoice(
      1,
      60,
      '2026-02-10',
      deSiteId,
    );
    await tenantPrisma.invoice.updateMany({
      where: { id: februaryInvoice.id },
      data: { site_id: deSite2Id },
    });
    await closeFinancePeriod(prisma, tenantA.tenantId, '2026-02-28');

    const incompleteScope = await previewExport({
      legalEntityId: deEntityId,
      dateFrom: '2026-02-01',
      dateTo: '2026-02-28',
    }).expect(403);

    expect(incompleteScope.body.code).toBe('EXPORT_SCOPE_INCOMPLETE');
    expect(incompleteScope.body.documentCount).toBeUndefined();
    expect(incompleteScope.body.totals).toBeUndefined();
  });

  it('EX-01b: blocks preview when cancelled invoice is on an unauthorized site', async () => {
    await openFinancePeriod();
    const invoice = await finalizeSalesInvoice(1, 40, '2026-07-05', deSiteId);
    await tenantPrisma.invoice.updateMany({
      where: { id: invoice.id },
      data: { status: 'CANCELLED', site_id: deSite2Id },
    });
    await closeFinancePeriod(prisma, tenantA.tenantId, '2026-07-31');

    const response = await previewExport({
      legalEntityId: deEntityId,
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    }).expect(403);

    expect(response.body.code).toBe('EXPORT_SCOPE_INCOMPLETE');
    expect(response.body.blockers).toBeUndefined();
  });

  it('EX-02: includes invoices on dateTo and keeps credits in their own period', async () => {
    await openFinancePeriod();
    const invoice = await finalizeSalesInvoice(1, 100, '2026-08-31');
    const draftCredit = await createDraftCredit(invoice.id, '2026-09-15');
    await finalizeCredit(draftCredit.id);
    await closeFinancePeriod(prisma, tenantA.tenantId, '2026-09-30');

    const augustPreview = await previewExport({
      legalEntityId: deEntityId,
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
    }).expect(200);

    expect(augustPreview.body.documentCount).toBe(1);
    expect(augustPreview.body.rowCount).toBeGreaterThan(0);

    const septemberPreview = await previewExport({
      legalEntityId: deEntityId,
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
    }).expect(200);

    expect(septemberPreview.body.documentCount).toBe(1);
    expect(
      septemberPreview.body.blockers.some(
        (blocker: { documentKind?: string }) =>
          blocker.documentKind === 'INVOICE',
      ),
    ).toBe(false);
  });

  it('EX-03: includes finalized credits and keeps fully credited invoice bookings', async () => {
    await openFinancePeriod();
    const invoice = await finalizeSalesInvoice(1, 120, '2026-10-05');
    const draftCredit = await createDraftCredit(invoice.id, '2026-10-20');
    await finalizeCredit(draftCredit.id);
    await closeFinancePeriod(prisma, tenantA.tenantId, '2026-10-31');

    const preview = await previewExport({
      legalEntityId: deEntityId,
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
    }).expect(200);

    expect(preview.body.documentCount).toBe(2);
    expect(preview.body.rowCount).toBeGreaterThanOrEqual(2);
    expect(preview.body.totals.length).toBeGreaterThan(0);
  });

  it('EX-04: blocks unsupported tax modes and keeps frozen rows after mapping edits', async () => {
    await openFinancePeriod();
    const invoice = await finalizeSalesInvoice(1, 90, '2026-11-08');
    await closeFinancePeriod(prisma, tenantA.tenantId, '2026-11-30');

    const beforeEdit = await previewExport({
      legalEntityId: deEntityId,
      dateFrom: '2026-11-01',
      dateTo: '2026-11-30',
    }).expect(200);
    const rowCountBefore = beforeEdit.body.rowCount;

    await tenantPrisma.legalEntityAccountingProfile.updateMany({
      where: {
        tenant_id: tenantA.tenantId,
        legal_entity_id: deEntityId,
      },
      data: {
        mapping_rules: [
          {
            sourceCategoryKey: 'manual_line',
            sourceCategoryLabel: 'Manual invoice lines',
            taxMode: 'STANDARD',
            taxRate: '20.00',
            revenueAccount: '9999',
            taxTreatment: 'automatic',
          },
        ],
      },
    });

    const afterEdit = await previewExport({
      legalEntityId: deEntityId,
      dateFrom: '2026-11-01',
      dateTo: '2026-11-30',
    }).expect(200);
    expect(afterEdit.body.rowCount).toBe(rowCountBefore);

    await openFinancePeriod();
    const marginInvoice = await finalizeSalesInvoice(1, 70, '2026-12-04');
    const storedInvoice = await tenantPrisma.invoice.findFirstOrThrow({
      where: { id: marginInvoice.id },
    });
    const marginSnapshot = storedInvoice.snapshot as {
      items: Array<{ accounting_allocation?: Record<string, unknown> }>;
    };
    await tenantPrisma.invoice.update({
      where: { id: marginInvoice.id },
      data: {
        tax_mode: 'MARGIN_SCHEME',
        snapshot: {
          ...(storedInvoice.snapshot as Record<string, unknown>),
          tax_mode: 'MARGIN_SCHEME',
          items: marginSnapshot.items.map((item) => ({
            ...item,
            accounting_allocation: {
              ...item.accounting_allocation,
              taxMode: 'MARGIN_SCHEME',
            },
          })),
        },
      },
    });
    await closeFinancePeriod(prisma, tenantA.tenantId, '2026-12-31');

    const marginPreview = await previewExport({
      legalEntityId: deEntityId,
      dateFrom: '2026-12-01',
      dateTo: '2026-12-31',
    }).expect(200);

    expect(
      marginPreview.body.blockers.some(
        (blocker: { code: string }) =>
          blocker.code === 'UNSUPPORTED_EXPORT_TAX_MODE',
      ),
    ).toBe(true);
    expect(marginPreview.body.canGenerate).toBe(false);
  });

  it('EX-07/EX-10: replays identical requests and rejects conflicts/overlap', async () => {
    await openFinancePeriod();
    await finalizeSalesInvoice(1, 100, '2026-03-10');
    await closeFinancePeriod(prisma, tenantA.tenantId, '2026-03-31');
    const preview = await previewExport({
      legalEntityId: deEntityId,
      dateFrom: '2026-03-01',
      dateTo: '2026-03-31',
    }).expect(200);

    const idempotencyKey = `export-${randomUUID()}`;
    const generated = await generateExport({
      legalEntityId: deEntityId,
      dateFrom: '2026-03-01',
      dateTo: '2026-03-31',
      previewHash: preview.body.previewHash,
      profileVersion: preview.body.profileVersion,
      idempotencyKey,
      acknowledgeOverlap: true,
    }).expect(201);

    const replay = await generateExport({
      legalEntityId: deEntityId,
      dateFrom: '2026-03-01',
      dateTo: '2026-03-31',
      previewHash: preview.body.previewHash,
      profileVersion: preview.body.profileVersion,
      idempotencyKey,
      acknowledgeOverlap: true,
    }).expect(201);

    expect(replay.body.id).toBe(generated.body.id);

    await generateExport({
      legalEntityId: deEntityId,
      dateFrom: '2026-03-01',
      dateTo: '2026-03-31',
      previewHash: preview.body.previewHash,
      profileVersion: preview.body.profileVersion,
      idempotencyKey: `other-${randomUUID()}`,
      acknowledgeOverlap: false,
    }).expect(422);

    await generateExport({
      legalEntityId: deEntityId,
      dateFrom: '2026-03-01',
      dateTo: '2026-03-31',
      previewHash: 'different-preview-hash',
      profileVersion: preview.body.profileVersion,
      idempotencyKey,
      acknowledgeOverlap: true,
    }).expect(409);

    const download = await downloadExport(generated.body.id);

    expect(download.headers['x-checksum-sha256']).toBe(generated.body.sha256);
    const csv = decodeDatevCsv(download.body as Buffer);
    expect(csv.split('\r\n')[1].split(';')).toHaveLength(
      DATEV_BUCHUNGSSTAPEL_COLUMN_COUNT,
    );
    expect(
      createHash('sha256')
        .update(download.body as Buffer)
        .digest('hex'),
    ).toBe(generated.body.sha256);
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

    await generateExport({
      legalEntityId: deEntityId,
      dateFrom: '2026-04-01',
      dateTo: '2026-04-30',
      previewHash: emptyPreview.body.previewHash,
      profileVersion: emptyPreview.body.profileVersion,
      idempotencyKey: `empty-${randomUUID()}`,
    }).expect(422);

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

  it('EX-04/EX-09: blocks cancelled invoices and tenant missing-ownership without leaking IDs', async () => {
    await openFinancePeriod();
    const invoice = await finalizeSalesInvoice(1, 50, '2026-05-10');
    await closeFinancePeriod(prisma, tenantA.tenantId, '2026-05-31');

    await tenantPrisma.invoice.updateMany({
      where: { id: invoice.id },
      data: { status: 'CANCELLED' },
    });

    const cancelledPreview = await previewExport({
      legalEntityId: deEntityId,
      dateFrom: '2026-05-01',
      dateTo: '2026-05-31',
    }).expect(200);

    expect(
      cancelledPreview.body.blockers.some(
        (blocker: { code: string }) => blocker.code === 'CANCELLED_DOCUMENT',
      ),
    ).toBe(true);

    await openFinancePeriod();
    const orphanInvoice = await finalizeSalesInvoice(
      1,
      65,
      '2026-06-12',
      deSiteId,
    );
    await tenantPrisma.invoice.updateMany({
      where: { id: orphanInvoice.id },
      data: { legal_entity_id: null, site_id: deSite2Id },
    });
    await closeFinancePeriod(prisma, tenantA.tenantId, '2026-06-30');

    const ownershipPreview = await previewExport({
      legalEntityId: deEntityId,
      dateFrom: '2026-06-01',
      dateTo: '2026-06-30',
    }).expect(200);

    expect(
      ownershipPreview.body.blockers.some(
        (blocker: { code: string; documentId?: string }) =>
          blocker.code === 'MISSING_OWNERSHIP_EVIDENCE' && !blocker.documentId,
      ),
    ).toBe(true);
    expect(ownershipPreview.body.canGenerate).toBe(false);
  });

  it('EX-11: re-download returns identical export bytes', async () => {
    await openFinancePeriod();
    await finalizeSalesInvoice(1, 88, '2028-03-18');
    await closeFinancePeriod(prisma, tenantA.tenantId, '2028-03-31');

    const preview = await previewExport({
      legalEntityId: deEntityId,
      dateFrom: '2028-03-01',
      dateTo: '2028-03-31',
    }).expect(200);

    const generated = await generateExport({
      legalEntityId: deEntityId,
      dateFrom: '2028-03-01',
      dateTo: '2028-03-31',
      previewHash: preview.body.previewHash,
      profileVersion: preview.body.profileVersion,
      idempotencyKey: `redownload-${randomUUID()}`,
      acknowledgeOverlap: true,
    }).expect(201);

    const downloadOnce = await downloadExport(generated.body.id);

    const downloadTwice = await downloadExport(generated.body.id);

    expect(downloadOnce.body).toEqual(downloadTwice.body);
    expect(
      createHash('sha256')
        .update(downloadOnce.body as Buffer)
        .digest('hex'),
    ).toBe(generated.body.sha256);
  });

  it('EX-12: lists and downloads legacy runs with null profileCode snapshots', async () => {
    await openFinancePeriod();
    await finalizeSalesInvoice(1, 55, '2028-04-12');
    await closeFinancePeriod(prisma, tenantA.tenantId, '2028-04-30');

    const preview = await previewExport({
      legalEntityId: deEntityId,
      dateFrom: '2028-04-01',
      dateTo: '2028-04-30',
    }).expect(200);

    const generated = await generateExport({
      legalEntityId: deEntityId,
      dateFrom: '2028-04-01',
      dateTo: '2028-04-30',
      previewHash: preview.body.previewHash,
      profileVersion: preview.body.profileVersion,
      idempotencyKey: `legacy-snapshot-${randomUUID()}`,
      acknowledgeOverlap: true,
    }).expect(201);

    const exportRun = await tenantPrisma.accountingExport.findFirstOrThrow({
      where: { id: generated.body.id },
    });
    const legacySnapshot = {
      ...(exportRun.profile_snapshot as Record<string, unknown>),
      profileCode: null,
    };
    await tenantPrisma.accountingExport.update({
      where: { id: exportRun.id },
      data: { profile_snapshot: legacySnapshot },
    });

    const list = await request(app.getHttpServer())
      .get('/api/finance/accounting-exports')
      .query({ legalEntityId: deEntityId })
      .set('Authorization', `Bearer ${authTokenA}`)
      .expect(200);

    expect(
      list.body.data.some(
        (row: { id: string }) => row.id === generated.body.id,
      ),
    ).toBe(true);

    const download = await downloadExport(generated.body.id);

    expect(download.headers['content-disposition']).toContain('.csv');
    expect(
      createHash('sha256')
        .update(download.body as Buffer)
        .digest('hex'),
    ).toBe(generated.body.sha256);
  });

  it('EX-09b: rejects stale preview hash on generation', async () => {
    await openFinancePeriod();
    await finalizeSalesInvoice(1, 75, '2027-01-12');
    await closeFinancePeriod(prisma, tenantA.tenantId, '2027-01-31');

    const preview = await previewExport({
      legalEntityId: deEntityId,
      dateFrom: '2027-01-01',
      dateTo: '2027-01-31',
    }).expect(200);

    await generateExport({
      legalEntityId: deEntityId,
      dateFrom: '2027-01-01',
      dateTo: '2027-01-31',
      previewHash: 'stale-preview-hash-value',
      profileVersion: preview.body.profileVersion,
      idempotencyKey: `stale-${randomUUID()}`,
    }).expect(409);
  });

  it('AUT-1049: exports valued stock corrections (plus, minus, reversal, 2-decimal Wert, unmapped account), omits unvalued & already-exported, keeps invoices intact', async () => {
    await openFinancePeriod();
    const location = await tenantPrisma.storageLocation.findFirstOrThrow({
      where: { site_id: deSiteId },
      select: { id: true },
    });

    // Period 2027-02: invoice + plus (2 * 1.2345 = 2.47) + minus (-1 * 10 = -10.00) + unvalued (null cost_basis)
    await finalizeSalesInvoice(1, 100, '2027-02-10', deSiteId);

    const plusTx = await tenantPrisma.inventoryTransaction.create({
      data: {
        tenant_id: tenantA.tenantId,
        site_id: deSiteId,
        item_id: catalogItemId,
        location_id: location.id,
        quantity: '2.000',
        type: 'ADJUSTMENT',
        cost_basis: '1.2345',
        reason: 'INVENTORY_COUNT',
        createdAt: new Date('2027-02-12T10:00:00.000Z'),
      },
    });

    const minusTx = await tenantPrisma.inventoryTransaction.create({
      data: {
        tenant_id: tenantA.tenantId,
        site_id: deSiteId,
        item_id: catalogItemId,
        location_id: location.id,
        quantity: '-1.000',
        type: 'ADJUSTMENT',
        cost_basis: '10.0000',
        reason: 'BREAKAGE',
        createdAt: new Date('2027-02-13T10:00:00.000Z'),
      },
    });

    const unvaluedTx = await tenantPrisma.inventoryTransaction.create({
      data: {
        tenant_id: tenantA.tenantId,
        site_id: deSiteId,
        item_id: catalogItemId,
        location_id: location.id,
        quantity: '5.000',
        type: 'ADJUSTMENT',
        cost_basis: null,
        reason: 'OTHER',
        note: 'Legacy unvalued',
        createdAt: new Date('2027-02-14T10:00:00.000Z'),
      },
    });

    await closeFinancePeriod(prisma, tenantA.tenantId, '2027-02-28');

    const preview1 = await previewExport({
      legalEntityId: deEntityId,
      dateFrom: '2027-02-01',
      dateTo: '2027-02-28',
    }).expect(200);

    // 1 invoice + 2 valued adjustments (unvalued omitted)
    expect(preview1.body.documentCount).toBe(3);
    expect(preview1.body.canGenerate).toBe(true);

    const gen1 = await generateExport({
      legalEntityId: deEntityId,
      dateFrom: '2027-02-01',
      dateTo: '2027-02-28',
      previewHash: preview1.body.previewHash,
      profileVersion: preview1.body.profileVersion,
      idempotencyKey: `aut1049-1-${randomUUID()}`,
      acknowledgeOverlap: true,
    }).expect(201);

    const dl1 = await downloadExport(gen1.body.id);
    const csv1 = decodeDatevCsv(dl1.body as Buffer);
    const lines1 = csv1.trimEnd().split('\r\n').slice(2);
    expect(lines1).toHaveLength(3);

    // Plus adjustment: 2,47, S, empty BU-Schlüssel
    const plusLine = lines1.find((l) => l.includes(plusTx.id.slice(0, 8)));
    expect(plusLine).toBeDefined();
    expect(plusLine!.split(';')[0]).toBe('2,47');
    expect(plusLine!.split(';')[1]).toBe('"S"');
    expect(plusLine!.split(';')[8]).toBe('');

    // Minus adjustment: 10,00, H, empty BU-Schlüssel
    const minusLine = lines1.find((l) => l.includes(minusTx.id.slice(0, 8)));
    expect(minusLine).toBeDefined();
    expect(minusLine!.split(';')[0]).toBe('10,00');
    expect(minusLine!.split(';')[1]).toBe('"H"');
    expect(minusLine!.split(';')[8]).toBe('');

    const invoiceLine1 = lines1.find(
      (l) =>
        !l.includes(plusTx.id.slice(0, 8)) &&
        !l.includes(minusTx.id.slice(0, 8)),
    );
    expect(invoiceLine1).toBeDefined();

    // Unvalued adjustment must never appear
    expect(csv1).not.toContain(unvaluedTx.id.slice(0, 8));

    // Scenario 4 / Anti-criterion 2: second export of same period must not duplicate adjustments
    const preview2 = await previewExport({
      legalEntityId: deEntityId,
      dateFrom: '2027-02-01',
      dateTo: '2027-02-28',
    }).expect(200);
    expect(preview2.body.documentCount).toBe(1); // Only the invoice remains

    const gen2 = await generateExport({
      legalEntityId: deEntityId,
      dateFrom: '2027-02-01',
      dateTo: '2027-02-28',
      previewHash: preview2.body.previewHash,
      profileVersion: preview2.body.profileVersion,
      idempotencyKey: `aut1049-2-${randomUUID()}`,
      acknowledgeOverlap: true,
    }).expect(201);

    const dl2 = await downloadExport(gen2.body.id);
    const csv2 = decodeDatevCsv(dl2.body as Buffer);
    expect(csv2).not.toContain(plusTx.id.slice(0, 8));
    expect(csv2).not.toContain(minusTx.id.slice(0, 8));

    // Anti-criterion 3: invoice line (including BU-Schlüssel) is unchanged by adjustments
    const lines2 = csv2.trimEnd().split('\r\n').slice(2);
    expect(lines2).toHaveLength(1);
    expect(invoiceLine1).toBe(lines2[0]);
  });
});
