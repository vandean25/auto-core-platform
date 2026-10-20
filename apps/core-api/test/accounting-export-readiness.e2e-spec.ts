import { createE2eApp } from './helpers/e2e-suite.js';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import type { TenantMemberRole } from '@prisma/client';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestUsers,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
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

const READINESS_PATH = '/api/finance/accounting-export-readiness';
// The notice for a document without a site names no document, as the loader redacts it.
const REDACTED_NOTICE =
  'A document in the selected period has incomplete ownership evidence.';

type ReadinessBody = {
  data: { id: string; blockers: { code: string }[] }[];
  tenantWideBlockers: { code: string }[];
};

describe('Accounting export readiness (e2e)', () => {
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
  let customerId: string;
  let catalogItemId: string;
  let userId: string;
  const ids = {
    de1: '',
    legacyV1: '',
    atInvoice: '',
    entityNoSite: '',
    de2: '',
    creditNote: '',
    noEntity: '',
  };
  // Users created for refusal cases. afterAll removes them: site-context.e2e-spec.ts
  // updates every user with a null active site, across tenants, so leftovers break it.
  const outsiderUserIds: string[] = [];

  beforeAll(async () => {
    app = await createE2eApp();

    prisma = app.get<PrismaService>(PrismaService);
    authService = app.get<AuthService>(AuthService);

    tenantA = await createTestTenant(prisma, 'aut352a');
    tenantB = await createTestTenant(prisma, 'aut352b');
    tenantPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
    authTokenA = createTestAuthToken(authService, tenantA);
    authTokenB = createTestAuthToken(authService, tenantB);

    // Invoice and sales order numbers are unique across tenants in this database,
    // and earlier suites can leave rows behind. Start from empty tables, as
    // accounting-export.e2e-spec.ts does.
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
    userId = user.id;

    await tenantPrisma.siteMembership.create({
      data: {
        tenant_id: tenantA.tenantId,
        user_id: userId,
        site_id: deSiteId,
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
    await seedReadySellerAndAccountingProfile(prisma, tenantA.tenantId);

    const customer = await seedInvoiceReadyCustomer(prisma, tenantA.tenantId);
    customerId = customer.id;

    const catalogItem = await tenantPrisma.catalogItem.create({
      data: {
        sku: `AUT352-${Date.now()}`,
        name: 'Brake Disc',
        cost_price: 20,
        retail_price: 40,
      },
    });
    catalogItemId = catalogItem.id;

    const location = await tenantPrisma.storageLocation.create({
      data: {
        code: `LOC-${deSiteId.slice(0, 8)}`,
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

    // Mixed March 2026 period for the Berlin entity: a v2 DE invoice, a v1
    // (legacy) invoice, an AT invoice, a second v2 DE invoice, a v2 DE credit
    // note, and a Berlin invoice with no site. The site-less invoice is a row
    // with a missing-ownership blocker, and its gap is also a notice that names
    // no document, as export preview shows it. A last invoice has no legal
    // entity, so it is a tenant-wide ownership notice that is not attributed to
    // Berlin.
    ids.de1 = (await finalizeSalesInvoice(1, 100, '2026-03-05')).id;
    ids.legacyV1 = (await finalizeSalesInvoice(1, 60, '2026-03-10')).id;
    await markInvoiceSnapshotAsVersion1(ids.legacyV1);
    ids.atInvoice = (await finalizeSalesInvoice(1, 70, '2026-03-12')).id;
    await reassignInvoiceCountry(ids.atInvoice, 'AT');
    ids.entityNoSite = (await finalizeSalesInvoice(1, 40, '2026-03-15')).id;
    await tenantPrisma.invoice.update({
      where: { id: ids.entityNoSite },
      data: { site_id: null },
    });
    ids.de2 = (await finalizeSalesInvoice(2, 50, '2026-03-20')).id;

    const draftCredit = await createDraftCredit(ids.de1, '2026-03-25');
    await finalizeCredit(draftCredit.id);
    ids.creditNote = draftCredit.id;

    ids.noEntity = (await finalizeSalesInvoice(1, 30, '2026-03-28')).id;
    await tenantPrisma.invoice.update({
      where: { id: ids.noEntity },
      data: { legal_entity_id: null },
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
    await cleanupTestUsers(prisma, outsiderUserIds);
    await teardownTestApp(app, prisma);
  });

  function openFinancePeriod() {
    return openAccountingExportFinancePeriod(tenantPrisma, tenantA.tenantId);
  }

  async function finalizeSalesInvoice(
    quantity: number,
    unitPrice: number,
    invoiceDate: string,
  ) {
    return createAccountingExportInvoice(
      { app, tenantPrisma, authToken: authTokenA, customerId, catalogItemId },
      {
        quantity,
        unitPrice,
        invoiceDate,
        siteId: deSiteId,
        legalEntityId: deEntityId,
      },
    );
  }

  async function markInvoiceSnapshotAsVersion1(invoiceId: string) {
    const stored = await tenantPrisma.invoice.findFirstOrThrow({
      where: { id: invoiceId },
    });
    await tenantPrisma.invoice.update({
      where: { id: invoiceId },
      data: {
        snapshot: {
          ...(stored.snapshot as Record<string, unknown>),
          schema_version: 1,
        },
      },
    });
  }

  async function reassignInvoiceCountry(invoiceId: string, countryIso: string) {
    const items = await tenantPrisma.invoiceItem.findMany({
      where: { invoice_id: invoiceId },
    });
    await Promise.all(
      items.map((item) =>
        tenantPrisma.invoiceItem.update({
          where: { id: item.id },
          data: {
            accounting_snapshot: {
              ...(item.accounting_snapshot as Record<string, unknown>),
              countryIso,
            },
          },
        }),
      ),
    );

    const stored = await tenantPrisma.invoice.findFirstOrThrow({
      where: { id: invoiceId },
    });
    const snapshot = stored.snapshot as {
      items: Array<{ accounting_allocation?: Record<string, unknown> }>;
    };
    await tenantPrisma.invoice.update({
      where: { id: invoiceId },
      data: {
        snapshot: {
          ...(stored.snapshot as Record<string, unknown>),
          items: snapshot.items.map((item) => ({
            ...item,
            accounting_allocation: {
              ...item.accounting_allocation,
              countryIso,
            },
          })),
        },
      },
    });
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

    return draft.body as { id: string };
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

  async function seedAdminWithoutSiteAccess(
    prefix: string,
    role: TenantMemberRole,
  ): Promise<TestTenantResult> {
    const unique = `${prefix}-${randomUUID()}`;
    const firebaseUid = `e2e-user-${unique}`;
    const email = `${unique}@example.com`;
    const user = await prisma.user.create({
      data: {
        firebaseUid,
        email,
        active_tenant_id: tenantA.tenantId,
        memberships: {
          create: { tenant_id: tenantA.tenantId, role, is_active: true },
        },
      },
      select: { id: true },
    });
    outsiderUserIds.push(user.id);
    return { tenantId: tenantA.tenantId, firebaseUid, email, role };
  }

  function readinessRequest(
    query: Record<string, string | number> = {},
    token = authTokenA,
  ) {
    return request(app.getHttpServer())
      .get(READINESS_PATH)
      .query({
        legalEntityId: deEntityId,
        dateFrom: '2026-03-01',
        dateTo: '2026-03-31',
        ...query,
      })
      .set('Authorization', `Bearer ${token}`);
  }

  function previewRequest() {
    return request(app.getHttpServer())
      .post('/api/finance/accounting-exports/preview')
      .set('Authorization', `Bearer ${authTokenA}`)
      .send({
        legalEntityId: deEntityId,
        dateFrom: '2026-03-01',
        dateTo: '2026-03-31',
      });
  }

  function idsOf(body: { data: { id: string }[] }) {
    return body.data.map((row) => row.id);
  }

  // The codes the page shows: each listed row's blockers, then the tenant-wide notices.
  function readinessCodes(body: ReadinessBody) {
    return [
      ...body.data.flatMap((row) => row.blockers.map((blocker) => blocker.code)),
      ...body.tenantWideBlockers.map((blocker) => blocker.code),
    ];
  }

  function previewCodes(body: { blockers: { code: string }[] }) {
    return body.blockers.map((blocker) => blocker.code);
  }

  it('RD-01: reports exportable and blocked documents, reasons, and tenant-wide blockers for a mixed period', async () => {
    const response = await readinessRequest().expect(200);

    expect(response.body.summary).toEqual({
      documentCount: 6,
      exportableCount: 3,
      blockedCount: 3,
      documentKinds: [
        { kind: 'INVOICE', documentCount: 5, exportableCount: 2, blockedCount: 3 },
        {
          kind: 'CREDIT_NOTE',
          documentCount: 1,
          exportableCount: 1,
          blockedCount: 0,
        },
      ],
      reasons: [
        { code: 'LEGACY_DOCUMENT_UNSUPPORTED', documentCount: 1 },
        { code: 'MISSING_OWNERSHIP_EVIDENCE', documentCount: 1 },
        { code: 'UNSUPPORTED_EXPORT_COUNTRY', documentCount: 1 },
      ],
    });
    // The site-less Berlin invoice's gap is a redacted notice; the invoice with
    // no legal entity is named, because its site is authorized.
    expect(response.body.tenantWideBlockers).toEqual([
      { code: 'MISSING_OWNERSHIP_EVIDENCE', message: REDACTED_NOTICE },
      expect.objectContaining({
        code: 'MISSING_OWNERSHIP_EVIDENCE',
        documentId: ids.noEntity,
      }),
    ]);
    expect(response.body).toMatchObject({
      periodClosed: false,
      lockDate: null,
      exportProfile: { configured: true, canGenerate: true },
    });
  });

  it('RD-02: filters by reason and by document type, with a remediable link per document', async () => {
    const byReason = await readinessRequest({
      reason: 'UNSUPPORTED_EXPORT_COUNTRY',
    }).expect(200);

    expect(byReason.body.data).toEqual([
      expect.objectContaining({
        id: ids.atInvoice,
        kind: 'INVOICE',
        status: 'BLOCKED',
        href: `/sales/invoices/${ids.atInvoice}`,
        blockers: [
          expect.objectContaining({ code: 'UNSUPPORTED_EXPORT_COUNTRY' }),
        ],
      }),
    ]);
    expect(byReason.body.meta).toEqual({
      total: 1,
      page: 1,
      limit: 25,
      pageCount: 1,
    });
    expect(byReason.body.summary.blockedCount).toBe(3);

    // Berlin's site-less invoice is listed once, as a row with no site.
    const missingOwnership = await readinessRequest({
      reason: 'MISSING_OWNERSHIP_EVIDENCE',
    }).expect(200);
    expect(missingOwnership.body.data).toEqual([
      expect.objectContaining({
        id: ids.entityNoSite,
        status: 'BLOCKED',
        site: null,
      }),
    ]);

    const creditNotes = await readinessRequest({
      documentKind: 'CREDIT_NOTE',
    }).expect(200);

    expect(creditNotes.body.data).toEqual([
      expect.objectContaining({
        id: ids.creditNote,
        kind: 'CREDIT_NOTE',
        status: 'EXPORTABLE',
        href: `/finance/credit-notes/${ids.creditNote}`,
      }),
    ]);
  });

  it('RD-03: paginates the listed documents in period order', async () => {
    const page2 = await readinessRequest({ limit: 2, page: 2 }).expect(200);

    expect(page2.body.meta).toEqual({
      total: 6,
      page: 2,
      limit: 2,
      pageCount: 3,
    });
    expect(idsOf(page2.body)).toEqual([
      ids.atInvoice,
      ids.entityNoSite,
    ]);
  });

  it('RD-03b: sorts the listed documents on the server before paging', async () => {
    const newestFirst = await readinessRequest({
      sortField: 'date',
      sortDirection: 'desc',
      limit: 3,
    }).expect(200);

    expect(idsOf(newestFirst.body)).toEqual([
      ids.creditNote,
      ids.de2,
      ids.entityNoSite,
    ]);
    expect(newestFirst.body.meta.total).toBe(6);
  });

  it('RD-04: reports a closed period once the lock date covers it, and agrees with export preview', async () => {
    await closeFinancePeriod(prisma, tenantA.tenantId, '2026-03-31');

    const readiness = await readinessRequest().expect(200);
    expect(readiness.body.periodClosed).toBe(true);
    expect(readiness.body.lockDate).toEqual(expect.any(String));

    const preview = await previewRequest().expect(200);

    expect([...new Set(readinessCodes(readiness.body))].sort()).toEqual(
      [...new Set(previewCodes(preview.body))].sort(),
    );
    expect(preview.body.canGenerate).toBe(false);
  });

  it('RD-05: refuses callers who are not tenant admins, and admins without active site access', async () => {
    const technician = await seedAdminWithoutSiteAccess('aut352-tech', 'TECH');
    await readinessRequest(
      {},
      createTestAuthToken(authService, technician),
    ).expect(403);

    const outsider = await seedAdminWithoutSiteAccess('aut352-outsider', 'ADMIN');
    const scopeRefusal = await readinessRequest(
      {},
      createTestAuthToken(authService, outsider),
    ).expect(403);

    expect(scopeRefusal.body.code).toBe('EXPORT_SCOPE_INCOMPLETE');
    expect(scopeRefusal.body.summary).toBeUndefined();
    expect(scopeRefusal.body.data).toBeUndefined();
  });

  it('RD-06: isolates tenants, so another tenant never sees this entity or its documents', async () => {
    await readinessRequest({}, authTokenB).expect(404);

    const tenantBPrisma = createTenantAwarePrisma(prisma, tenantB.tenantId);
    const ownEntity = await tenantBPrisma.legalEntity.create({
      data: {
        tenant_id: tenantB.tenantId,
        name: 'Vienna Motors GmbH',
        country_iso: 'AT',
        is_active: true,
        address_street: 'Ringstraße 1',
        address_zip: '1010',
        address_city: 'Wien',
        tax_number: 'ATU12345678',
        payment_terms_days: 14,
        payment_terms_text: 'Zahlbar innerhalb von 14 Tagen.',
      },
    });

    const own = await readinessRequest(
      { legalEntityId: ownEntity.id },
      authTokenB,
    ).expect(200);

    expect(own.body.summary.documentCount).toBe(0);
    expect(own.body.data).toEqual([]);
    expect(own.body.tenantWideBlockers).toEqual([]);
    // No accounting profile, so preview would refuse this entity's periods.
    expect(own.body.exportProfile).toEqual({
      configured: false,
      canGenerate: false,
    });
  });

  it('RD-07: rejects fiscal-year-spanning periods, unknown filters and oversized pages', async () => {
    const crossYear = await readinessRequest({
      dateFrom: '2026-12-01',
      dateTo: '2027-01-31',
    }).expect(422);
    expect(crossYear.body.code).toBe('EXPORT_INVALID_RANGE');

    await readinessRequest({ reason: 'NOT_A_REASON' }).expect(400);
    await readinessRequest({ limit: 500 }).expect(400);
    await readinessRequest({ sortField: 'reasons' }).expect(400);
    await readinessRequest({ sortDirection: 'sideways' }).expect(400);
  });

  it('RD-08: requires an authenticated caller', async () => {
    await request(app.getHttpServer())
      .get(READINESS_PATH)
      .query({
        legalEntityId: deEntityId,
        dateFrom: '2026-03-01',
        dateTo: '2026-03-31',
      })
      .expect(401);
  });

  it('RD-09: refuses a period with an inactive contributing site, and lists it again once the site is active', async () => {
    await tenantPrisma.site.update({
      where: { id: deSiteId },
      data: { is_active: false },
    });

    const refused = await readinessRequest().expect(403);
    expect(refused.body.code).toBe('EXPORT_SCOPE_INCOMPLETE');
    expect(refused.body.data).toBeUndefined();

    await tenantPrisma.site.update({
      where: { id: deSiteId },
      data: { is_active: true },
    });
    await readinessRequest().expect(200);
  });

  it('RD-10: keeps the ownership notice for a cancelled document without a site, as preview does', async () => {
    // A cancelled invoice returns before the ownership check, so its row shows
    // only CANCELLED_DOCUMENT. The notice must stay visible or the gap is hidden.
    await tenantPrisma.invoice.update({
      where: { id: ids.entityNoSite },
      data: { status: 'CANCELLED' },
    });

    const readiness = await readinessRequest().expect(200);
    const row = readiness.body.data.find(
      (document: { id: string }) => document.id === ids.entityNoSite,
    );
    expect(row.blockers.map((blocker: { code: string }) => blocker.code)).toEqual([
      'CANCELLED_DOCUMENT',
    ]);
    // A site-less invoice's notice is redacted and names no document, as
    // preview's does. Only this one redacted notice is expected in the period.
    expect(
      readiness.body.tenantWideBlockers.filter(
        (blocker: { documentId?: string }) => blocker.documentId === undefined,
      ),
    ).toEqual([{ code: 'MISSING_OWNERSHIP_EVIDENCE', message: REDACTED_NOTICE }]);

    const preview = await previewRequest().expect(200);
    expect(previewCodes(preview.body)).toEqual(
      expect.arrayContaining(['CANCELLED_DOCUMENT', 'MISSING_OWNERSHIP_EVIDENCE']),
    );
  });
});
