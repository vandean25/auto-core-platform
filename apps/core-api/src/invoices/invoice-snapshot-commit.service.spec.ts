import {
  CustomerType,
  InvoiceStatus,
  InvoiceTaxMode,
  Prisma,
} from '@prisma/client';
import { FIXED_SOURCE_CATEGORY_KEYS } from '../finance/accounting-profile/accounting-profile.types.js';
import type { SiteContextService } from '../site/site-context.service.js';
import { InvoiceSnapshotCommitService } from './invoice-snapshot-commit.service.js';

describe('InvoiceSnapshotCommitService', () => {
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
    legalEntity: { findFirst: jest.fn() },
    legalEntityAccountingProfile: { findFirst: jest.fn() },
    catalogItem: { findMany: jest.fn() },
  };

  let service: InvoiceSnapshotCommitService;

  beforeEach(() => {
    service = new InvoiceSnapshotCommitService(siteContext);
    jest.clearAllMocks();
    siteContext.listAuthorizedSiteIds.mockResolvedValue(['site-1']);
    tx.$queryRaw.mockResolvedValue([{ id: 'site-1', is_active: true }]);
    tx.workshopOrder.findFirst.mockResolvedValue({ site_id: 'site-1' });
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

    expect(prepared.snapshot.items[0].accounting_allocation?.sourceCategoryKey).toBe(
      FIXED_SOURCE_CATEGORY_KEYS.LABOR,
    );
    expect(prepared.snapshot.items[1].accounting_allocation?.sourceCategoryKey).toBe(
      'revenue_group:5',
    );
  });
});
