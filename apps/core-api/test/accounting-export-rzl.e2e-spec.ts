import { createE2eApp } from './helpers/e2e-suite.js';
import { createHash, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  DEFAULT_RZL_FORMAT_VERSION,
  RZL_SERIALIZER_RELEASE_ENV,
} from '../src/finance/accounting-profile/accounting-profile.codes.js';
import {
  FIXED_SOURCE_CATEGORY_KEYS,
} from '../src/finance/accounting-profile/accounting-profile.types.js';
import {
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  type TestTenantResult,
} from './tenant-test-utils.js';
import {
  buildDeMappingRules,
  closeFinancePeriod,
} from './accounting-export-test-utils.js';
import { seedInvoiceReadyCustomer } from './invoice-snapshot-v2-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('RZL accounting export (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantPrisma: PrismaService;
  let authService: AuthService;
  let tenant: TestTenantResult;
  let authToken: string;
  let userId: string;
  let atEntityId: string;
  let atSiteId: string;
  let customerId: string;
  let catalogItemId: string;
  let previousReleaseFlag: string | undefined;

  const profileWhere = () => ({
    tenant_id_legal_entity_id: {
      tenant_id: tenant.tenantId,
      legal_entity_id: atEntityId,
    },
  });

  beforeAll(async () => {
    previousReleaseFlag = process.env[RZL_SERIALIZER_RELEASE_ENV];
    process.env[RZL_SERIALIZER_RELEASE_ENV] = 'true';

    app = await createE2eApp();

    prisma = app.get<PrismaService>(PrismaService);
    authService = app.get<AuthService>(AuthService);

    // Same reset as the DATEV export e2e: order and invoice numbers are unique
    // across tenants, so earlier runs must not leave numbers behind.
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

    tenant = await createTestTenant(prisma, 'aut350');
    tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    authToken = createTestAuthToken(authService, tenant);

    const user = await prisma.user.findFirstOrThrow({
      where: { firebaseUid: tenant.firebaseUid },
      select: { id: true },
    });
    userId = user.id;

    const atEntity = await tenantPrisma.legalEntity.create({
      data: {
        tenant_id: tenant.tenantId,
        name: 'Wien Motors GmbH',
        country_iso: 'AT',
        is_active: true,
        address_street: 'Hauptstraße 1',
        address_zip: '1010',
        address_city: 'Wien',
        vat_id: 'ATU12345678',
        payment_terms_days: 14,
        payment_terms_text: 'Zahlbar innerhalb von 14 Tagen.',
      },
    });
    atEntityId = atEntity.id;

    const atSite = await tenantPrisma.site.create({
      data: {
        tenant_id: tenant.tenantId,
        legal_entity_id: atEntityId,
        code: 'AT-WIEN',
        name: 'Wien Branch',
        timezone: 'Europe/Vienna',
        holiday_country_iso: 'AT',
        is_active: true,
      },
    });
    atSiteId = atSite.id;

    await tenantPrisma.siteMembership.create({
      data: {
        tenant_id: tenant.tenantId,
        user_id: userId,
        site_id: atSiteId,
        is_active: true,
      },
    });
    await prisma.user.update({
      where: { id: userId },
      data: { active_site_id: atSiteId },
    });

    const revenueGroups = await tenantPrisma.revenueGroup.findMany({
      where: { tenant_id: tenant.tenantId },
      orderBy: { id: 'asc' },
    });
    await tenantPrisma.legalEntityAccountingProfile.create({
      data: {
        tenant_id: tenant.tenantId,
        legal_entity_id: atEntityId,
        profile_code: 'ACP-RZL-AT-EUR-1',
        format_version: DEFAULT_RZL_FORMAT_VERSION,
        chart: 'UGB',
        account_length: 4,
        fiscal_year_start_month: 1,
        default_debtor_account: '2000',
        mapping_rules: [
          ...buildDeMappingRules('20.00', revenueGroups),
          {
            sourceCategoryKey: FIXED_SOURCE_CATEGORY_KEYS.VEHICLE_MARGIN,
            sourceCategoryLabel: 'Vehicle margin scheme',
            taxMode: 'MARGIN_SCHEME',
            taxRate: '0.00',
            revenueAccount: '8400',
            taxTreatment: 'automatic',
          },
        ],
        serializer_params: {
          rzl: {
            firmNumber: 'FN-AT-1',
            costCenterLength: null,
            steuercodes: { vat20: '20', vat13: '13', vat10: '10' },
          },
        },
        is_enabled: false,
      },
    });

    const customer = await seedInvoiceReadyCustomer(prisma, tenant.tenantId);
    customerId = customer.id;

    const catalogItem = await tenantPrisma.catalogItem.create({
      data: {
        tenant_id: tenant.tenantId,
        sku: `AUT350-${Date.now()}`,
        name: 'Brake Pad',
        cost_price: 20,
        retail_price: 40,
      },
    });
    catalogItemId = catalogItem.id;

    const location = await tenantPrisma.storageLocation.create({
      data: {
        tenant_id: tenant.tenantId,
        code: `LOC-AT-${atSiteId.slice(0, 8)}`,
        name: 'Warehouse',
        type: 'warehouse',
        site_id: atSiteId,
      },
    });
    await tenantPrisma.inventoryStock.create({
      data: {
        tenant_id: tenant.tenantId,
        catalog_item_id: catalogItemId,
        site_id: atSiteId,
        location_id: location.id,
        quantity_on_hand: 100,
      },
    });

    await openFinancePeriod();
  });

  afterAll(async () => {
    if (previousReleaseFlag === undefined) {
      delete process.env[RZL_SERIALIZER_RELEASE_ENV];
    } else {
      process.env[RZL_SERIALIZER_RELEASE_ENV] = previousReleaseFlag;
    }
    // Invoice numbers are unique across tenants, so this tenant's invoices must not outlive the suite.
    await tenantPrisma.invoiceItem.deleteMany();
    await tenantPrisma.invoice.deleteMany();
    await tenantPrisma.invoiceSequence.deleteMany();
    await teardownTestApp(app, prisma);
  });

  async function openFinancePeriod() {
    const currentYear = new Date().getFullYear();
    await tenantPrisma.financeSettings.upsert({
      where: { tenant_id: tenant.tenantId },
      update: { lock_date: null },
      create: {
        tenant_id: tenant.tenantId,
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

  async function finalizeAtInvoice(
    quantity: number,
    unitPrice: number,
    invoiceDate: string,
  ) {
    const orderRes = await request(app.getHttpServer())
      .post('/api/sales-orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customer_id: customerId,
        items: [
          {
            catalog_item_id: catalogItemId,
            description: 'Brake Pad',
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

    const invoiceResponse = await request(app.getHttpServer())
      .post(`/api/sales-orders/${orderRes.body.id}/create-invoice`)
      .set('Authorization', `Bearer ${authToken}`);
    if (invoiceResponse.status !== 201) {
      throw new Error(
        `AT create-invoice failed (${invoiceResponse.status}): ${JSON.stringify(invoiceResponse.body)}`,
      );
    }
    const invoiceRes = invoiceResponse;

    await tenantPrisma.invoice.updateMany({
      where: { id: invoiceRes.body.id },
      data: {
        date: new Date(`${invoiceDate}T12:00:00.000Z`),
        site_id: atSiteId,
        legal_entity_id: atEntityId,
      },
    });

    const finalized = await request(app.getHttpServer())
      .put(`/api/sales/invoices/${invoiceRes.body.id}/finalize`)
      .set('Authorization', `Bearer ${authToken}`);

    if (finalized.status !== 200) {
      throw new Error(
        `AT invoice finalize failed (${finalized.status}): ${JSON.stringify(finalized.body)}`,
      );
    }
    return finalized.body;
  }

  function previewRzlExport(dateFrom: string, dateTo: string) {
    return request(app.getHttpServer())
      .post('/api/finance/accounting-exports/preview')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ legalEntityId: atEntityId, dateFrom, dateTo });
  }

  function generateRzlExport(body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/api/finance/accounting-exports')
      .set('Authorization', `Bearer ${authToken}`)
      .send(body);
  }

  function downloadRun(id: string) {
    return request(app.getHttpServer())
      .get(`/api/finance/accounting-exports/${id}/download`)
      .set('Authorization', `Bearer ${authToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
  }

  it('RZ-01: keeps the RZL profile closed while the release flag is off', async () => {
    process.env[RZL_SERIALIZER_RELEASE_ENV] = 'false';
    await tenantPrisma.legalEntityAccountingProfile.update({
      where: profileWhere(),
      data: { is_enabled: false },
    });
    await finalizeAtInvoice(1, 100, '2026-11-08');
    await closeFinancePeriod(prisma, tenant.tenantId, '2026-11-30');

    const profile = await request(app.getHttpServer())
      .get(`/api/legal-entities/${atEntityId}/accounting-profile`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(profile.body.serializer_released).toBe(false);

    // Enabling is refused while the release flag is off.
    await request(app.getHttpServer())
      .patch(`/api/legal-entities/${atEntityId}/accounting-profile`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ expectedVersion: profile.body.version, isEnabled: true })
      .expect(400);

    // A profile that is already enabled (for example enabled before the flag was
    // turned off) can still be saved, but it cannot generate.
    await tenantPrisma.legalEntityAccountingProfile.update({
      where: profileWhere(),
      data: { is_enabled: true },
    });
    await request(app.getHttpServer())
      .patch(`/api/legal-entities/${atEntityId}/accounting-profile`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ expectedVersion: profile.body.version, isEnabled: true })
      .expect(200);

    const preview = await previewRzlExport('2026-11-01', '2026-11-30').expect(200);
    expect(preview.body.canGenerate).toBe(false);

    const generated = await generateRzlExport({
      legalEntityId: atEntityId,
      dateFrom: '2026-11-01',
      dateTo: '2026-11-30',
      previewHash: preview.body.previewHash,
      profileVersion: preview.body.profileVersion,
      idempotencyKey: `rzl-closed-${randomUUID()}`,
      acknowledgeOverlap: true,
    }).expect(422);
    expect(generated.body.code ?? generated.body.message?.code).toBe(
      'EXPORT_PROFILE_DISABLED',
    );

    await tenantPrisma.legalEntityAccountingProfile.update({
      where: profileWhere(),
      data: { is_enabled: false },
    });
  });

  it('RZ-02: reports incomplete RZL configuration as global blockers', async () => {
    process.env[RZL_SERIALIZER_RELEASE_ENV] = 'true';
    const profile = await tenantPrisma.legalEntityAccountingProfile.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId, legal_entity_id: atEntityId },
    });
    await tenantPrisma.legalEntityAccountingProfile.update({
      where: profileWhere(),
      data: {
        is_enabled: true,
        serializer_params: {
          rzl: {
            firmNumber: 'FN-AT-1',
            costCenterLength: null,
            steuercodes: { vat20: '20', vat13: null, vat10: '10' },
          },
        },
      },
    });

    const preview = await previewRzlExport('2026-11-01', '2026-11-30').expect(200);
    expect(preview.body.canGenerate).toBe(false);
    expect(preview.body.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'ACCOUNTING_MAPPING_INCOMPLETE',
          message: 'RZL export profile is incomplete: Steuercode for 13% VAT.',
        }),
      ]),
    );

    await tenantPrisma.legalEntityAccountingProfile.update({
      where: profileWhere(),
      data: { serializer_params: profile.serializer_params ?? {} },
    });
  });

  it('RZ-03: generates a released RZL run from frozen facts and replays identical bytes', async () => {
    process.env[RZL_SERIALIZER_RELEASE_ENV] = 'true';
    await openFinancePeriod();
    await tenantPrisma.legalEntityAccountingProfile.update({
      where: profileWhere(),
      data: {
        is_enabled: true,
        serializer_params: {
          rzl: {
            firmNumber: 'FN-AT-1',
            costCenterLength: null,
            steuercodes: { vat20: '20', vat13: '13', vat10: '10' },
          },
        },
      },
    });
    await finalizeAtInvoice(1, 100, '2028-06-12');
    await closeFinancePeriod(prisma, tenant.tenantId, '2028-06-30');

    const preview = await previewRzlExport('2028-06-01', '2028-06-30').expect(200);
    expect(preview.body.canGenerate).toBe(true);
    expect(preview.body.blockers).toEqual([]);
    expect(preview.body.rowCount).toBe(1);

    const idempotencyKey = `rzl-${randomUUID()}`;
    const generated = await generateRzlExport({
      legalEntityId: atEntityId,
      dateFrom: '2028-06-01',
      dateTo: '2028-06-30',
      previewHash: preview.body.previewHash,
      profileVersion: preview.body.profileVersion,
      idempotencyKey,
      acknowledgeOverlap: true,
    }).expect(201);
    expect(generated.body.filename).toMatch(/^RZL_.*\.csv$/);

    const replay = await generateRzlExport({
      legalEntityId: atEntityId,
      dateFrom: '2028-06-01',
      dateTo: '2028-06-30',
      previewHash: preview.body.previewHash,
      profileVersion: preview.body.profileVersion,
      idempotencyKey,
      acknowledgeOverlap: true,
    }).expect(201);
    expect(replay.body.id).toBe(generated.body.id);

    const first = await downloadRun(generated.body.id);
    const second = await downloadRun(generated.body.id);
    expect(first.body.equals(second.body)).toBe(true);
    expect(
      createHash('sha256').update(first.body as Buffer).digest('hex'),
    ).toBe(generated.body.sha256);

    const csv = (first.body as Buffer).toString('latin1');
    expect(csv.startsWith('K;"RZL-FIBU-IMPORT-ACP-DRAFT-1";"FN-AT-1";')).toBe(true);
    expect(csv).toContain('B;AR;');
    expect(csv).toContain('S;120,00;"2000";"8400";20;');
    expect(csv.endsWith('\r\n')).toBe(true);

    await tenantPrisma.legalEntityAccountingProfile.update({
      where: profileWhere(),
      data: { is_enabled: false },
    });
  });

  it('RZ-05: keeps completed export bytes when live profile settings change', async () => {
    process.env[RZL_SERIALIZER_RELEASE_ENV] = 'true';
    await openFinancePeriod();
    await tenantPrisma.legalEntityAccountingProfile.update({
      where: profileWhere(),
      data: {
        is_enabled: true,
        serializer_params: {
          rzl: {
            firmNumber: 'FN-AT-1',
            costCenterLength: null,
            steuercodes: { vat20: '20', vat13: '13', vat10: '10' },
          },
        },
      },
    });
    await finalizeAtInvoice(1, 100, '2029-03-10');
    await closeFinancePeriod(prisma, tenant.tenantId, '2029-03-31');

    const preview = await previewRzlExport('2029-03-01', '2029-03-31').expect(200);
    const generated = await generateRzlExport({
      legalEntityId: atEntityId,
      dateFrom: '2029-03-01',
      dateTo: '2029-03-31',
      previewHash: preview.body.previewHash,
      profileVersion: preview.body.profileVersion,
      idempotencyKey: `rzl-frozen-${randomUUID()}`,
      acknowledgeOverlap: true,
    }).expect(201);

    const beforeMutation = await downloadRun(generated.body.id);

    await tenantPrisma.legalEntityAccountingProfile.update({
      where: profileWhere(),
      data: {
        serializer_params: {
          rzl: {
            firmNumber: 'FN-CHANGED',
            costCenterLength: null,
            steuercodes: { vat20: '99', vat13: '88', vat10: '77' },
          },
        },
      },
    });

    const afterMutation = await downloadRun(generated.body.id);
    expect(afterMutation.body.equals(beforeMutation.body)).toBe(true);
    expect(
      createHash('sha256').update(afterMutation.body as Buffer).digest('hex'),
    ).toBe(generated.body.sha256);

    await tenantPrisma.legalEntityAccountingProfile.update({
      where: profileWhere(),
      data: { is_enabled: false },
    });
  });

  it('RZ-04: refuses to save an enabled RZL profile whose firm number the file cannot carry', async () => {
    process.env[RZL_SERIALIZER_RELEASE_ENV] = 'true';
    await tenantPrisma.legalEntityAccountingProfile.update({
      where: profileWhere(),
      data: { is_enabled: true },
    });
    const current = await request(app.getHttpServer())
      .get(`/api/legal-entities/${atEntityId}/accounting-profile`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const saved = await request(app.getHttpServer())
      .patch(`/api/legal-entities/${atEntityId}/accounting-profile`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        expectedVersion: current.body.version,
        isEnabled: true,
        serializerParams: {
          rzl: {
            firmNumber: 'FN;AT-1',
            costCenterLength: null,
            steuercodes: { vat20: '20', vat13: '13', vat10: '10' },
          },
        },
      })
      .expect(400);
    expect(JSON.stringify(saved.body)).toContain(
      'RZL export configuration is incomplete: firm_number',
    );

    await tenantPrisma.legalEntityAccountingProfile.update({
      where: profileWhere(),
      data: { is_enabled: false },
    });
  });
});
