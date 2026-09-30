import { AuthService } from '../src/auth/auth.service.js';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { createGlobalValidationPipe } from './../src/common/index.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import {
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
} from './tenant-test-utils.js';
import {
  seedInvoiceReadyCustomer,
  seedReadySellerAndAccountingProfile,
} from './invoice-snapshot-v2-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';
import {
  confirmDocumentBrandTheme,
  createReadyDocumentBrandLogo,
  exerciseFrozenInvoiceArchiveLifecycle,
  installFakeInvoiceArchiveStorage,
  seedLegacyInvoicePdf,
  withInvoiceBrandingWriterDisabled,
} from './invoice-branding-archive-test-utils.js';

describe('SalesController (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let customerId: string;
  let catalogItemId: string;
  let legalEntityId: string;
  let tenantId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();
    installFakeInvoiceArchiveStorage(app);
    basePrisma = app.get<PrismaService>(PrismaService);
    prisma = basePrisma;

    const testTenant = await createTestTenant(prisma);
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(prisma, tenantId);
    authToken = createTestAuthToken(app.get(AuthService), testTenant);
    legalEntityId = (
      await prisma.legalEntity.findFirstOrThrow({
        where: { tenant_id: testTenant.tenantId },
        select: { id: true },
      })
    ).id;

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "inventory_transactions",
        "inventory_stocks",
        "invoice_items",
        "invoices",
        "invoice_sequences",
        "sales_order_items",
        "sales_orders"
      CASCADE;
    `);

    await seedReadySellerAndAccountingProfile(prisma, testTenant.tenantId);
    const customer = await seedInvoiceReadyCustomer(
      prisma,
      testTenant.tenantId,
    );
    customerId = customer.id;

    const catalogItem = await prisma.catalogItem.create({
      data: {
        sku: `TEST-ITEM-${Date.now()}`,
        name: 'Test Item',
        cost_price: 10,
        retail_price: 20,
      },
    });
    catalogItemId = catalogItem.id;

    // Create Stock
    const siteId = await resolveTestMainSiteId(prisma, testTenant.tenantId);
    const location = await prisma.storageLocation.create({
      data: {
        code: `LOC-${Date.now()}`,
        name: 'Test Location',
        type: 'warehouse',
        site_id: siteId,
      },
    });

    await prisma.inventoryStock.create({
      data: {
        catalog_item_id: catalogItemId,
        site_id: siteId,
        location_id: location.id,
        quantity_on_hand: 100,
      },
    });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.inventoryTransaction.deleteMany();
    await prisma.inventoryStock.deleteMany();
    await prisma.storageLocation.deleteMany();
    await basePrisma.$executeRawUnsafe(
      'DELETE FROM "invoice_brand_asset_references" WHERE "tenant_id" = $1',
      tenantId,
    );
    await prisma.documentBrandProfile.deleteMany();
    await prisma.documentBrandAsset.deleteMany();
    await prisma.invoiceItem.deleteMany();
    await prisma.invoice.deleteMany();
    await prisma.salesOrderItem.deleteMany();
    await prisma.salesOrder.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.catalogItem.deleteMany();
    await prisma.revenueGroup.deleteMany();
    await prisma.brand.deleteMany();
    await teardownTestApp(app, prisma);
  });

  it('/api/sales/invoices (POST) - rejects source-less draft creation', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/sales/invoices')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId: customerId,
        items: [
          {
            catalogItemId: catalogItemId,
            description: 'Test Item Snapshot',
            quantity: 2,
            unitPrice: 20,
            taxRate: 20,
          },
        ],
      })
      .expect(400);

    expect(response.body.code).toBe('SOURCE_DOCUMENT_REQUIRED');
  });

  it.each(['default', 'confirmed'] as const)(
    'sales origin freezes %s branding before invoice effects',
    async (profileMode) => {
    const hasConfirmedProfile = profileMode === 'confirmed';
    const orderRes = await request(app.getHttpServer())
      .post('/api/sales-orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customer_id: customerId,
        items: [
          {
            catalog_item_id: catalogItemId,
            description: 'Finalize Test Item',
            quantity: 1,
            unit_price: 100,
            tax_rate: 20,
          },
        ],
      })
      .expect(201);

    await prisma.salesOrder.updateMany({
      where: { id: orderRes.body.id },
      data: { status: 'CONFIRMED' },
    });

    const draftResponse = await request(app.getHttpServer())
      .post(`/api/sales-orders/${orderRes.body.id}/create-invoice`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);

    const logo = hasConfirmedProfile
      ? await createReadyDocumentBrandLogo(
          prisma,
          tenantId,
          legalEntityId,
          `sales-${profileMode}`,
        )
      : null;
    let expectedProfileRevision = 0;
    if (logo) {
      const confirmedTheme = await confirmDocumentBrandTheme({
        app,
        authToken,
        legalEntityId,
        logoAssetId: logo.id,
        headerText: 'Sales profile before commitment',
      });
      expectedProfileRevision = confirmedTheme.body.activeRevision;
    }

    const invoiceSequenceBeforeDisabledCommit =
      await prisma.invoiceSequence.findFirst({
        where: { tenant_id: tenantId },
        select: { current: true },
      });
    await withInvoiceBrandingWriterDisabled(async () => {
      const disabledFinalize = await request(app.getHttpServer())
        .put(`/api/sales/invoices/${draftResponse.body.id}/finalize`)
        .set('Authorization', `Bearer ${authToken}`);
      expect(disabledFinalize.status).toBe(503);
      expect(disabledFinalize.body).toMatchObject({
        code: 'INVOICE_BRANDING_WRITER_DISABLED',
        message:
          'Invoice commitment is temporarily unavailable while branded invoice issuance is disabled.',
      });
    });
    const rejectedInvoice = await prisma.invoice.findFirstOrThrow({
      where: { id: draftResponse.body.id },
      select: { status: true, snapshot: true, invoice_number: true },
    });
    expect(rejectedInvoice).toMatchObject({
      status: 'DRAFT',
      snapshot: null,
      invoice_number: null,
    });
    expect(
      await prisma.salesOrder.findFirstOrThrow({
        where: { id: orderRes.body.id },
        select: { status: true },
      }),
    ).toMatchObject({ status: 'CONFIRMED' });
    expect(
      await prisma.invoiceSequence.findFirst({
        where: { tenant_id: tenantId },
        select: { current: true },
      }),
    ).toEqual(invoiceSequenceBeforeDisabledCommit);

    const finalizeResponse = await request(app.getHttpServer())
      .put(`/api/sales/invoices/${draftResponse.body.id}/finalize`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(finalizeResponse.body.status).toBe('FINALIZED');
    expect(finalizeResponse.body.invoice_number).toMatch(/^RE-\d{4}-\d{4}$/);
    for (const privateField of [
      'snapshot',
      'pdf_archive_bucket',
      'pdf_archive_key',
      'pdf_archive_generation',
      'pdf_archive_sha256',
      'pdf_storage_bucket',
      'pdf_storage_key',
    ]) {
      expect(finalizeResponse.body).not.toHaveProperty(privateField);
    }

    const committedInvoice = await prisma.invoice.findFirstOrThrow({
      where: { id: draftResponse.body.id },
      select: { snapshot: true },
    });
    const snapshot = committedInvoice.snapshot as {
      schema_version: number;
      snapshot_created_at: string;
      template_version: string;
      branding: {
        schema_version: number;
        renderer_version: string;
        resolved_at: string;
        profile_id: string | null;
        profile_revision: number;
        preset_id: string;
        logo: { asset_id: string } | null;
      };
    };
    expect(snapshot.schema_version).toBe(2);
    expect(snapshot.template_version).toBe('invoice-brand-v1');
    expect(snapshot.branding).toMatchObject({
      schema_version: 1,
      renderer_version: 'invoice-brand-v1',
    });
    expect(snapshot.branding.resolved_at).toBe(snapshot.snapshot_created_at);
    expect(snapshot.branding.preset_id).toBe('standard-v1');
    expect(snapshot.branding.logo?.asset_id ?? null).toBe(logo?.id ?? null);
    if (hasConfirmedProfile) {
      expect(snapshot.branding.profile_id).toEqual(expect.any(String));
      expect(snapshot.branding.profile_revision).toBe(expectedProfileRevision);
    } else {
      expect(snapshot.branding.profile_id).toBeNull();
      expect(snapshot.branding.profile_revision).toBe(0);
    }
    await exerciseFrozenInvoiceArchiveLifecycle({
      app,
      prisma,
      authToken,
      invoiceId: draftResponse.body.id,
      legalEntityId,
      logoAssetId: logo?.id ?? null,
    });
    const publicInvoice = await request(app.getHttpServer())
      .get(`/api/sales/invoices/${draftResponse.body.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    for (const privateField of [
      'snapshot',
      'pdf_archive_bucket',
      'pdf_archive_key',
      'pdf_archive_generation',
      'pdf_archive_sha256',
      'pdf_storage_bucket',
      'pdf_storage_key',
    ]) {
      expect(publicInvoice.body).not.toHaveProperty(privateField);
    }
    },
  );

  it('legacy V1 and V2 invoice downloads preserve their existing storage path', async () => {
    const siteId = await resolveTestMainSiteId(prisma, tenantId);
    const snapshotCreatedAt = '2025-01-01T12:00:00.000Z';
    const baseSnapshot = {
      date: '2025-01-01',
      due_date: '2025-01-15',
      notes: null,
      tax_mode: 'STANDARD',
      total_net: '100.00',
      total_tax: '20.00',
      total_gross: '120.00',
      customer: {
        id: customerId,
        type: 'PRIVATE',
        company_name: null,
        first_name: 'Legacy',
        last_name: 'Customer',
        email: null,
        phone: null,
        vat_id: null,
        address_street: null,
        address_city: null,
        address_zip: null,
        address_country: null,
      },
      vehicle: null,
      items: [
        {
          description: 'Legacy item',
          quantity: '1.00',
          unit_price: '100.00',
          tax_rate: '20.00',
          line_discount_type: null,
          line_discount_value: null,
          line_total: '120.00',
          revenue_group_name: null,
        },
      ],
      snapshot_created_at: snapshotCreatedAt,
    };
    const legacyCases = [
      {
        name: 'V1',
        snapshot: {
          id: 'legacy-v1',
          invoice_number: 'LEGACY-V1',
          ...baseSnapshot,
        },
      },
      {
        name: 'V2',
        snapshot: {
          schema_version: 2,
          document_kind: 'INVOICE',
          template_version: 'invoice-pdf-v1',
          site_id: siteId,
          legal_entity_id: legalEntityId,
          currency: 'EUR',
          seller: { name: 'Legacy Seller' },
          tax_breakdown: [],
          ...baseSnapshot,
        },
      },
    ] as const;

    for (const [index, legacyCase] of legacyCases.entries()) {
      const pdfBytes = Buffer.from(`legacy ${legacyCase.name} PDF`);
      const invoice = await prisma.invoice.create({
        data: {
          tenant_id: tenantId,
          site_id: siteId,
          legal_entity_id: legalEntityId,
          customer_id: customerId,
          status: 'ISSUED',
          invoice_number: `LEGACY-${legacyCase.name}-${index}`,
          date: new Date('2025-01-01T12:00:00.000Z'),
          due_date: new Date('2025-01-15T12:00:00.000Z'),
          total_net: 100,
          total_tax: 20,
          total_gross: 120,
          snapshot: legacyCase.snapshot,
          pdf_storage_bucket: 'legacy-invoice-bucket',
          pdf_storage_key: `invoices/legacy-${legacyCase.name}-${index}.pdf`,
          pdf_generated_at: new Date('2025-01-01T12:00:00.000Z'),
        },
        select: { id: true, pdf_storage_key: true },
      });
      seedLegacyInvoicePdf(
        app,
        'legacy-invoice-bucket',
        invoice.pdf_storage_key!,
        pdfBytes,
      );

      const response = await request(app.getHttpServer())
        .get(`/api/invoices/${invoice.id}/pdf`)
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true)
        .parse((incoming, callback) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
          incoming.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(response.body).toEqual(pdfBytes);
    }
  });
});
