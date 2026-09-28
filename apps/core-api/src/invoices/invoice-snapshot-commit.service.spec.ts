import {
  CustomerType,
  InvoiceStatus,
  InvoiceTaxMode,
  Prisma,
} from '@prisma/client';
import { ServiceUnavailableException } from '@nestjs/common';
import { FIXED_SOURCE_CATEGORY_KEYS } from '../finance/accounting-profile/accounting-profile.types.js';
import type { SiteContextService } from '../site/site-context.service.js';
import { InvoiceSnapshotCommitService } from './invoice-snapshot-commit.service.js';

describe('InvoiceSnapshotCommitService', () => {
  const originalWriterFlag = process.env.INVOICE_BRANDING_WRITER_ENABLED;
  const siteContext = {
    listAuthorizedSiteIds: jest.fn().mockResolvedValue(['site-1']),
  } as unknown as SiteContextService;

  const seller = {
    id: 'le-1',
    tenant_id: 'tenant-1',
    name: 'E2E GmbH',
    country_iso: 'AT' as const,
    is_active: true,
    address_street: 'Hauptstraße 1',
    address_line2: null,
    address_zip: '1010',
    address_city: 'Wien',
    tax_number: null,
    vat_id: 'ATU12345678',
    iban: null,
    bic: null,
    bank_name: null,
    email: null,
    phone: null,
    registration_number: null,
    registration_court: null,
    representatives: null,
    payment_terms_days: 14,
    payment_terms_text: 'Zahlbar innerhalb von 14 Tagen.',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const customer = {
    id: 'customer-1',
    tenant_id: 'tenant-1',
    type: CustomerType.PRIVATE,
    company_name: null,
    first_name: 'Max',
    last_name: 'Mustermann',
    email: 'max@example.com',
    phone: null,
    vat_id: null,
    address_street: 'Kundenstraße 2',
    address_zip: '1020',
    address_city: 'Wien',
    address_country: 'AT',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const tx = {
    $queryRaw: jest.fn(),
    workshopOrder: { findFirst: jest.fn() },
    site: { findFirst: jest.fn() },
    legalEntity: {
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    legalEntityAccountingProfile: { findFirst: jest.fn() },
    documentBrandProfile: { findFirst: jest.fn().mockResolvedValue(null) },
    documentBrandAsset: { findFirst: jest.fn() },
    invoiceBrandAssetReference: { create: jest.fn() },
    catalogItem: { findMany: jest.fn() },
    financeSettings: {
      findFirst: jest.fn().mockResolvedValue({ lock_date: null }),
    },
  };

  let service: InvoiceSnapshotCommitService;

  beforeEach(() => {
    service = new InvoiceSnapshotCommitService(siteContext);
    jest.clearAllMocks();
    process.env.INVOICE_BRANDING_WRITER_ENABLED = 'true';
    siteContext.listAuthorizedSiteIds.mockResolvedValue(['site-1']);
    tx.$queryRaw.mockResolvedValue([{ id: 'site-1', is_active: true }]);
    tx.workshopOrder.findFirst.mockResolvedValue({ site_id: 'site-1' });
    tx.documentBrandProfile.findFirst.mockResolvedValue(null);
    tx.documentBrandAsset.findFirst.mockResolvedValue(null);
    tx.site.findFirst.mockResolvedValue({
      id: 'site-1',
      legal_entity_id: 'le-1',
    });
    tx.legalEntity.findFirst.mockResolvedValue(seller);
    tx.legalEntityAccountingProfile.findFirst.mockResolvedValue({
      tenant_id: 'tenant-1',
      legal_entity_id: 'le-1',
      profile_code: 'ACP-DATEV-DE-EUR-1',
      format_version: 'EXTF-700-Buchungsstapel-13',
      advisor_number: '12345',
      client_number: '1',
      account_length: 4,
      default_debtor_account: '1000',
      mapping_rules: [
        {
          sourceCategoryKey: FIXED_SOURCE_CATEGORY_KEYS.LABOR,
          sourceCategoryLabel: 'Labor / workshop services',
          taxMode: 'STANDARD',
          taxRate: '20.00',
          revenueAccount: '8500',
          taxTreatment: 'automatic',
        },
        {
          sourceCategoryKey: 'revenue_group:5',
          sourceCategoryLabel: 'Parts 20%',
          taxMode: 'STANDARD',
          taxRate: '20.00',
          revenueAccount: '8400',
          taxTreatment: 'automatic',
        },
      ],
    });
    tx.catalogItem.findMany.mockResolvedValue([
      {
        id: 'part-1',
        revenue_group_id: 5,
        revenue_group: { id: 5, name: 'Parts 20%' },
      },
    ]);
  });

  afterAll(() => {
    if (originalWriterFlag === undefined) {
      delete process.env.INVOICE_BRANDING_WRITER_ENABLED;
    } else {
      process.env.INVOICE_BRANDING_WRITER_ENABLED = originalWriterFlag;
    }
  });

  it('writer gate disabled blocks commitment without fallback', async () => {
    process.env.INVOICE_BRANDING_WRITER_ENABLED = 'false';

    await expect(
      service.lockCommitmentContext(
        tx as never,
        'tenant-1',
        {
          sales_order_id: 'so-1',
          workshop_order_id: null,
          vehicle_sale_id: null,
        },
        new Date('2026-09-28'),
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(siteContext.listAuthorizedSiteIds).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('locks an invoice row using both tenant and invoice identifiers', async () => {
    tx.$queryRaw.mockResolvedValue([{ id: 'inv-1' }]);
    const lockInvoiceRow = (
      service as unknown as {
        lockInvoiceRow: (
          transaction: typeof tx,
          tenantId: string,
          invoiceId: string,
        ) => Promise<void>;
      }
    ).lockInvoiceRow.bind(service);

    await lockInvoiceRow(tx, 'tenant-1', 'inv-1');

    const [query, invoiceId, tenantId] = tx.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      string,
      string,
    ];
    expect(query.join('')).toContain('FROM invoices');
    expect(query.join('')).toContain('FOR UPDATE');
    expect([invoiceId, tenantId]).toEqual(['inv-1', 'tenant-1']);
  });

  it('fails closed when the tenant-scoped invoice row is missing', async () => {
    tx.$queryRaw.mockResolvedValue([]);
    const lockInvoiceRow = (
      service as unknown as {
        lockInvoiceRow: (
          transaction: typeof tx,
          tenantId: string,
          invoiceId: string,
        ) => Promise<void>;
      }
    ).lockInvoiceRow.bind(service);

    await expect(lockInvoiceRow(tx, 'tenant-1', 'inv-1')).rejects.toThrow(
      'Invoice not found',
    );
  });

  it('classifies workshop labor and catalog part lines separately', async () => {
    const prepared = await service.prepareV2Snapshot({
      tx: tx as never,
      tenantId: 'tenant-1',
      invoice: {
        id: 'inv-1',
        tenant_id: 'tenant-1',
        customer_id: customer.id,
        vehicle_id: null,
        sales_order_id: null,
        workshop_order_id: 'wo-1',
        vehicle_sale_id: null,
        site_id: 'site-1',
        legal_entity_id: 'le-1',
        currency: 'EUR',
        status: InvoiceStatus.DRAFT,
        tax_mode: InvoiceTaxMode.STANDARD,
        invoice_number: null,
        date: new Date('2026-04-01'),
        due_date: new Date('2026-04-15'),
        supply_date_from: null,
        supply_date_to: null,
        total_net: new Prisma.Decimal(180),
        total_tax: new Prisma.Decimal(36),
        total_gross: new Prisma.Decimal(216),
        notes: null,
        internal_notes: null,
        snapshot: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        customer,
        vehicle: null,
        items: [
          {
            id: 'line-labor',
            tenant_id: 'tenant-1',
            invoice_id: 'inv-1',
            catalog_item_id: null,
            description: 'Brake labor',
            quantity: new Prisma.Decimal(2),
            unit_price: new Prisma.Decimal(80),
            tax_rate: new Prisma.Decimal(20),
            line_discount_type: null,
            line_discount_value: null,
            line_total: new Prisma.Decimal(160),
            revenue_group_name: 'Labor / workshop services',
            accounting_snapshot: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: 'line-part',
            tenant_id: 'tenant-1',
            invoice_id: 'inv-1',
            catalog_item_id: 'part-1',
            description: 'Brake pad',
            quantity: new Prisma.Decimal(1),
            unit_price: new Prisma.Decimal(20),
            tax_rate: new Prisma.Decimal(20),
            line_discount_type: null,
            line_discount_value: null,
            line_total: new Prisma.Decimal(20),
            revenue_group_name: 'Parts 20%',
            accounting_snapshot: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
      invoiceNumber: 'RE-2026-0001',
    });

    expect(
      prepared.snapshot.items[0].accounting_allocation?.sourceCategoryKey,
    ).toBe(FIXED_SOURCE_CATEGORY_KEYS.LABOR);
    expect(
      prepared.snapshot.items[1].accounting_allocation?.sourceCategoryKey,
    ).toBe('revenue_group:5');
    expect(prepared.snapshot.template_version).toBe('invoice-brand-v1');
    expect(prepared.snapshot.branding).toMatchObject({
      schema_version: 1,
      profile_id: null,
      profile_revision: 0,
      preset_id: 'standard-v1',
      renderer_version: 'invoice-brand-v1',
      font_id: 'acp-sans-v1',
      logo: null,
    });
    expect(prepared.snapshot.branding?.resolved_at).toBe(
      prepared.snapshot.snapshot_created_at,
    );
    expect(tx.legalEntity.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.$queryRaw.mock.invocationCallOrder[0],
    );
    expect(
      tx.$queryRaw.mock.invocationCallOrder[0],
    ).toBeLessThan(tx.documentBrandProfile.findFirst.mock.invocationCallOrder[0]);
  });

  it('freezes the confirmed theme and exact READY logo generation', async () => {
    const logoAssetId = '3b825bc1-dcc9-4f2e-91fc-1b9905e6ba2e';
    const profile = {
      id: '8f507f3d-40e1-47c9-a451-73a2682c8b17',
      active_revision: 7,
      active_logo_asset_id: logoAssetId,
      active_theme: {
        schemaVersion: 1,
        presetId: 'standard-v1',
        logoAssetId,
        primaryColor: '#334155',
        secondaryColor: '#E5E7EB',
        fontId: 'acp-sans-v1',
        headerBand: 'primary',
        footerBand: 'secondary',
        headerText: 'Example GmbH',
        footerText: '',
      },
    };
    const asset = {
      id: logoAssetId,
      bucket: 'private-branding',
      object_key: 'tenant/entity/logo.png',
      object_generation: '1730000000000000',
      sha256: 'a'.repeat(64),
      detected_mime_type: 'image/png',
      pixel_width: 640,
      pixel_height: 240,
    };
    tx.documentBrandProfile.findFirst.mockResolvedValue(profile);
    tx.documentBrandAsset.findFirst.mockResolvedValue(asset);

    const prepared = await service.prepareV2Snapshot({
      tx: tx as never,
      tenantId: 'tenant-1',
      invoice: {
        id: 'inv-1',
        tenant_id: 'tenant-1',
        customer_id: customer.id,
        vehicle_id: null,
        sales_order_id: null,
        workshop_order_id: 'wo-1',
        vehicle_sale_id: null,
        site_id: 'site-1',
        legal_entity_id: 'le-1',
        currency: 'EUR',
        status: InvoiceStatus.DRAFT,
        tax_mode: InvoiceTaxMode.STANDARD,
        invoice_number: null,
        date: new Date('2026-04-01'),
        due_date: new Date('2026-04-15'),
        supply_date_from: null,
        supply_date_to: null,
        total_net: new Prisma.Decimal(100),
        total_tax: new Prisma.Decimal(20),
        total_gross: new Prisma.Decimal(120),
        notes: null,
        internal_notes: null,
        snapshot: null,
        global_discount_type: null,
        global_discount_value: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        customer,
        vehicle: null,
        items: [],
      } as never,
      invoiceNumber: 'RE-2026-0001',
    });

    expect(prepared.snapshot.branding).toMatchObject({
      profile_id: profile.id,
      profile_revision: 7,
      tokens: {
        primary_color: '#334155',
        header_band: 'primary',
        footer_band: 'secondary',
        header_text: 'Example GmbH',
      },
      logo: {
        asset_id: logoAssetId,
        bucket: 'private-branding',
        key: 'tenant/entity/logo.png',
        generation: '1730000000000000',
        sha256: 'a'.repeat(64),
        mime_type: 'image/png',
        width: 640,
        height: 240,
      },
    });
    expect(prepared.logoAssetId).toBe(logoAssetId);
    expect(
      tx.$queryRaw.mock.calls.map(([query]) => String(query)),
    ).toHaveLength(5);
  });

  it('persists the retained logo reference with the frozen invoice snapshot', async () => {
    const createReference = jest.fn();
    const invoiceUpdateMany = jest.fn();
    const itemUpdateMany = jest.fn();
    const tx = {
      invoice: { updateMany: invoiceUpdateMany },
      invoiceItem: { updateMany: itemUpdateMany },
      invoiceBrandAssetReference: { create: createReference },
    };
    const prepared = {
      snapshot: {
        branding: {
          logo: { asset_id: 'asset-1' },
        },
        items: [{ id: 'item-1', accounting_allocation: {} }],
      },
      ownership: { siteId: 'site-1', legalEntityId: 'entity-1' },
      dueDate: new Date('2026-10-01'),
      supplyFrom: new Date('2026-09-01'),
      supplyTo: new Date('2026-09-01'),
      logoAssetId: 'asset-1',
    } as never;

    await service.persistV2Snapshot(
      tx as never,
      'tenant-1',
      'invoice-1',
      prepared,
    );

    expect(createReference).toHaveBeenCalledWith({
      data: {
        tenant_id: 'tenant-1',
        legal_entity_id: 'entity-1',
        invoice_id: 'invoice-1',
        asset_id: 'asset-1',
      },
    });
    expect(invoiceUpdateMany).toHaveBeenCalledTimes(1);
    expect(itemUpdateMany).toHaveBeenCalledTimes(1);
  });

  it('rejects incomplete seller identity with SELLER_IDENTITY_INCOMPLETE', async () => {
    tx.legalEntity.findFirst.mockResolvedValue({
      ...seller,
      vat_id: null,
      tax_number: null,
    });

    await expect(
      service.prepareV2Snapshot({
        tx: tx as never,
        tenantId: 'tenant-1',
        invoice: {
          id: 'inv-1',
          tenant_id: 'tenant-1',
          customer_id: customer.id,
          vehicle_id: null,
          sales_order_id: null,
          workshop_order_id: 'wo-1',
          vehicle_sale_id: null,
          site_id: 'site-1',
          legal_entity_id: 'le-1',
          currency: 'EUR',
          status: InvoiceStatus.DRAFT,
          tax_mode: InvoiceTaxMode.STANDARD,
          invoice_number: null,
          date: new Date('2026-04-01'),
          due_date: new Date('2026-04-15'),
          supply_date_from: null,
          supply_date_to: null,
          total_net: new Prisma.Decimal(100),
          total_tax: new Prisma.Decimal(20),
          total_gross: new Prisma.Decimal(120),
          notes: null,
          internal_notes: null,
          snapshot: null,
          global_discount_type: null,
          global_discount_value: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          customer,
          vehicle: null,
          items: [],
        },
        invoiceNumber: '',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'SELLER_IDENTITY_INCOMPLETE',
        missingFields: ['vat_id'],
      },
    });
  });

  it('rejects incomplete customer identity with CUSTOMER_IDENTITY_INCOMPLETE', async () => {
    await expect(
      service.prepareV2Snapshot({
        tx: tx as never,
        tenantId: 'tenant-1',
        invoice: {
          id: 'inv-1',
          tenant_id: 'tenant-1',
          customer_id: customer.id,
          vehicle_id: null,
          sales_order_id: null,
          workshop_order_id: 'wo-1',
          vehicle_sale_id: null,
          site_id: 'site-1',
          legal_entity_id: 'le-1',
          currency: 'EUR',
          status: InvoiceStatus.DRAFT,
          tax_mode: InvoiceTaxMode.STANDARD,
          invoice_number: null,
          date: new Date('2026-04-01'),
          due_date: new Date('2026-04-15'),
          supply_date_from: null,
          supply_date_to: null,
          total_net: new Prisma.Decimal(100),
          total_tax: new Prisma.Decimal(20),
          total_gross: new Prisma.Decimal(120),
          notes: null,
          internal_notes: null,
          snapshot: null,
          global_discount_type: null,
          global_discount_value: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          customer: { ...customer, address_street: null },
          vehicle: null,
          items: [],
        },
        invoiceNumber: '',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'CUSTOMER_IDENTITY_INCOMPLETE',
        missingFields: ['address_street'],
      },
    });
  });

  it('rejects locked fiscal periods with FISCAL_PERIOD_LOCKED', async () => {
    tx.financeSettings.findFirst.mockResolvedValue({
      lock_date: new Date('2026-12-31'),
    });

    await expect(
      service.prepareV2Snapshot({
        tx: tx as never,
        tenantId: 'tenant-1',
        invoice: {
          id: 'inv-1',
          tenant_id: 'tenant-1',
          customer_id: customer.id,
          vehicle_id: null,
          sales_order_id: null,
          workshop_order_id: 'wo-1',
          vehicle_sale_id: null,
          site_id: 'site-1',
          legal_entity_id: 'le-1',
          currency: 'EUR',
          status: InvoiceStatus.DRAFT,
          tax_mode: InvoiceTaxMode.STANDARD,
          invoice_number: null,
          date: new Date('2026-06-01'),
          due_date: new Date('2026-06-15'),
          supply_date_from: null,
          supply_date_to: null,
          total_net: new Prisma.Decimal(100),
          total_tax: new Prisma.Decimal(20),
          total_gross: new Prisma.Decimal(120),
          notes: null,
          internal_notes: null,
          snapshot: null,
          global_discount_type: null,
          global_discount_value: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          customer,
          vehicle: null,
          items: [],
        },
        invoiceNumber: '',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'FISCAL_PERIOD_LOCKED',
      },
    });
  });
});
