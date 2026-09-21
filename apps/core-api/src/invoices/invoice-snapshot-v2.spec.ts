import {
  CustomerType,
  DiscountType,
  InvoiceStatus,
  InvoiceTaxMode,
  Prisma,
} from '@prisma/client';
import { buildInvoiceSnapshotV2 } from './invoice-snapshot-v2.js';
import type { ResolvedAccountingAllocation } from '../finance/accounting-profile/accounting-profile.types.js';

const allocation = (
  overrides: Partial<ResolvedAccountingAllocation> = {},
): ResolvedAccountingAllocation => ({
  profileCode: 'ACP-DATEV-DE-EUR-1',
  profileVersion: 1,
  sourceCategoryKey: 'manual_line',
  sourceCategoryLabel: 'Manual invoice lines',
  revenueAccount: '8400',
  debtorAccount: '1000',
  taxMode: 'STANDARD',
  taxRate: '20.00',
  taxTreatment: 'automatic',
  buKey: null,
  countryIso: 'AT',
  currency: 'EUR',
  ...overrides,
});

describe('buildInvoiceSnapshotV2', () => {
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
    id: 'cust-1',
    type: CustomerType.PRIVATE,
    first_name: 'Max',
    last_name: 'Mustermann',
    email: 'max@example.com',
    phone: null,
    vat_id: null,
    address_street: 'Kundenstraße 2',
    address_city: 'Wien',
    address_zip: '1020',
    address_country: 'AT',
    company_name: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('freezes seller, ownership and accounting allocation on v2 snapshot', () => {
    const snapshot = buildInvoiceSnapshotV2({
      invoice: {
        id: 'inv-1',
        tenant_id: 'tenant-1',
        invoice_number: 'RE-2026-0001',
        customer_id: customer.id,
        vehicle_id: null,
        sales_order_id: 'so-1',
        workshop_order_id: null,
        vehicle_sale_id: null,
        site_id: 'site-1',
        legal_entity_id: seller.id,
        tax_mode: InvoiceTaxMode.STANDARD,
        status: InvoiceStatus.FINALIZED,
        date: new Date('2026-09-20T10:00:00.000Z'),
        due_date: new Date('2026-10-04T10:00:00.000Z'),
        supply_date_from: new Date('2026-09-20T00:00:00.000Z'),
        supply_date_to: new Date('2026-09-20T00:00:00.000Z'),
        currency: 'EUR',
        global_discount_type: null,
        global_discount_value: null,
        total_net: new Prisma.Decimal('100.00'),
        total_tax: new Prisma.Decimal('20.00'),
        total_gross: new Prisma.Decimal('120.00'),
        notes: null,
        internal_notes: null,
        snapshot: null,
        pdf_storage_bucket: null,
        pdf_storage_key: null,
        pdf_generated_at: null,
        pdf_generation_error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [
          {
            id: 'line-1',
            tenant_id: 'tenant-1',
            invoice_id: 'inv-1',
            catalog_item_id: null,
            description: 'Service',
            quantity: new Prisma.Decimal('1.000'),
            unit_price: new Prisma.Decimal('100.00'),
            tax_rate: new Prisma.Decimal('20.00'),
            line_discount_type: null,
            line_discount_value: null,
            line_total: new Prisma.Decimal('100.00'),
            revenue_group_name: 'Sales',
            accounting_snapshot: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        customer,
        vehicle: null,
      },
      seller,
      siteId: 'site-1',
      legalEntityId: seller.id,
      lineAllocations: [
        {
          id: 'line-1',
          description: 'Service',
          quantity: new Prisma.Decimal('1.000'),
          unitPrice: new Prisma.Decimal('100.00'),
          taxRate: new Prisma.Decimal('20.00'),
          lineDiscountType: null,
          lineDiscountValue: null,
          revenueGroupName: 'Sales',
          accountingAllocation: allocation(),
        },
      ],
      committedAt: new Date('2026-09-20T12:00:00.000Z'),
    });

    expect(snapshot.schema_version).toBe(2);
    expect(snapshot.site_id).toBe('site-1');
    expect(snapshot.legal_entity_id).toBe(seller.id);
    expect(snapshot.seller.name).toBe('E2E GmbH');
    expect(snapshot.items[0].accounting_allocation.revenueAccount).toBe('8400');
    expect(snapshot.tax_breakdown[0].gross).toBe('120.00');
  });

  it('aggregates multi-rate lines into sorted tax_breakdown buckets', () => {
    const snapshot = buildInvoiceSnapshotV2({
      invoice: buildInvoice({
        total_net: new Prisma.Decimal('300.00'),
        total_tax: new Prisma.Decimal('59.00'),
        total_gross: new Prisma.Decimal('359.00'),
      }),
      seller,
      siteId: 'site-1',
      legalEntityId: seller.id,
      lineAllocations: [
        buildLineAllocation({
          id: 'line-20',
          unitPrice: new Prisma.Decimal('200.00'),
          taxRate: new Prisma.Decimal('20.00'),
        }),
        buildLineAllocation({
          id: 'line-19',
          unitPrice: new Prisma.Decimal('100.00'),
          taxRate: new Prisma.Decimal('19.00'),
        }),
      ],
    });

    expect(snapshot.tax_breakdown).toEqual([
      { rate: '19.00', net: '100.00', tax: '19.00', gross: '119.00' },
      { rate: '20.00', net: '200.00', tax: '40.00', gross: '240.00' },
    ]);
    expect(snapshot.total_gross).toBe('359.00');
  });

  it('applies line and global discounts before tax_breakdown allocation', () => {
    const snapshot = buildInvoiceSnapshotV2({
      invoice: buildInvoice({
        global_discount_type: DiscountType.PERCENTAGE,
        global_discount_value: new Prisma.Decimal('10.00'),
        total_net: new Prisma.Decimal('81.00'),
        total_tax: new Prisma.Decimal('16.20'),
        total_gross: new Prisma.Decimal('97.20'),
      }),
      seller,
      siteId: 'site-1',
      legalEntityId: seller.id,
      lineAllocations: [
        buildLineAllocation({
          id: 'line-1',
          unitPrice: new Prisma.Decimal('100.00'),
          taxRate: new Prisma.Decimal('20.00'),
          lineDiscountType: DiscountType.PERCENTAGE,
          lineDiscountValue: new Prisma.Decimal('10.00'),
        }),
      ],
    });

    expect(snapshot.items[0].net).toBe('81.00');
    expect(snapshot.items[0].tax).toBe('16.20');
    expect(snapshot.tax_breakdown).toEqual([
      { rate: '20.00', net: '81.00', tax: '16.20', gross: '97.20' },
    ]);
  });

  it('freezes margin metadata without exposing it in customer-facing item fields', () => {
    const snapshot = buildInvoiceSnapshotV2({
      invoice: buildInvoice({
        tax_mode: InvoiceTaxMode.MARGIN_SCHEME,
        total_net: new Prisma.Decimal('0.00'),
        total_tax: new Prisma.Decimal('0.00'),
        total_gross: new Prisma.Decimal('15000.00'),
      }),
      seller,
      siteId: 'site-1',
      legalEntityId: seller.id,
      lineAllocations: [
        buildLineAllocation({
          id: 'line-margin',
          description: '2020 VW Golf VIN WVWZZZ1234567890',
          unitPrice: new Prisma.Decimal('15000.00'),
          taxRate: new Prisma.Decimal('20.00'),
          revenueGroupName: 'Vehicle used (margin)',
        }),
      ],
      margin: {
        cost_basis: '12000.00',
        margin_tax: '500.00',
        tax_rate: '20.00',
        calculation_profile: 'vehicle-margin-v1',
      },
    });

    expect(snapshot.margin).toEqual({
      cost_basis: '12000.00',
      margin_tax: '500.00',
      tax_rate: '20.00',
      calculation_profile: 'vehicle-margin-v1',
    });
    expect(snapshot.tax_mode).toBe(InvoiceTaxMode.MARGIN_SCHEME);
    expect(snapshot.items[0].description).toContain('VIN');
  });
});

function buildInvoice(
  overrides: Partial<Parameters<typeof buildInvoiceSnapshotV2>[0]['invoice']> = {},
) {
  return {
    id: 'inv-1',
    tenant_id: 'tenant-1',
    invoice_number: 'RE-2026-0001',
    customer_id: 'cust-1',
    vehicle_id: null,
    sales_order_id: 'so-1',
    workshop_order_id: null,
    vehicle_sale_id: null,
    site_id: 'site-1',
    legal_entity_id: 'le-1',
    tax_mode: InvoiceTaxMode.STANDARD,
    status: InvoiceStatus.FINALIZED,
    date: new Date('2026-09-20T10:00:00.000Z'),
    due_date: new Date('2026-10-04T10:00:00.000Z'),
    supply_date_from: new Date('2026-09-20T00:00:00.000Z'),
    supply_date_to: new Date('2026-09-20T00:00:00.000Z'),
    currency: 'EUR',
    global_discount_type: null,
    global_discount_value: null,
    total_net: new Prisma.Decimal('100.00'),
    total_tax: new Prisma.Decimal('20.00'),
    total_gross: new Prisma.Decimal('120.00'),
    notes: null,
    internal_notes: null,
    snapshot: null,
    pdf_storage_bucket: null,
    pdf_storage_key: null,
    pdf_generated_at: null,
    pdf_generation_error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [],
    customer: {
      id: 'cust-1',
      type: CustomerType.PRIVATE,
      first_name: 'Max',
      last_name: 'Mustermann',
      email: 'max@example.com',
      phone: null,
      vat_id: null,
      address_street: 'Kundenstraße 2',
      address_city: 'Wien',
      address_zip: '1020',
      address_country: 'AT',
      company_name: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    vehicle: null,
    ...overrides,
  };
}

function buildLineAllocation(
  overrides: Partial<Parameters<typeof buildInvoiceSnapshotV2>[0]['lineAllocations'][number]> = {},
) {
  return {
    id: 'line-1',
    description: 'Service',
    quantity: new Prisma.Decimal('1.000'),
    unitPrice: new Prisma.Decimal('100.00'),
    taxRate: new Prisma.Decimal('20.00'),
    lineDiscountType: null,
    lineDiscountValue: null,
    revenueGroupName: 'Sales',
    accountingAllocation: allocation(),
    ...overrides,
  };
}
