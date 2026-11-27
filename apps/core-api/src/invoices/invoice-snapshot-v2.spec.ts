import {
  CustomerType,
  DiscountType,
  InvoiceStatus,
  InvoiceTaxMode,
  LegalEntityCountry,
  Prisma,
  RksvMode,
} from '@prisma/client';
import {
  buildInvoiceSnapshotV2,
  computeStandardInvoiceTotals,
} from './invoice-snapshot-v2.js';
import { isInvoiceSnapshotV2 } from './invoice-snapshot-v2.validation.js';
import { customerRow } from './invoice-fixtures.spec.support.js';
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
    rksv_mode: RksvMode.OFF,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const customer = customerRow({
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
  });

  it('embeds frozen document locale metadata on new v2 snapshots', () => {
    const snapshot = buildInvoiceSnapshotV2({
      invoice: buildInvoice(),
      seller,
      siteId: 'site-1',
      legalEntityId: seller.id,
      lineAllocations: [buildLineAllocation()],
      documentLocale: 'en',
    });
    expect(snapshot.document_locale).toBe('en');
    expect(snapshot.format_locale).toBe('de-AT');
    expect(snapshot.translation_bundle_version).toBeTruthy();
  });

  it('freezes seller, ownership and accounting allocation on v2 snapshot', () => {
    const snapshot = buildInvoiceSnapshotV2({
      invoice: {
        id: 'inv-1',
        tenant_id: 'tenant-1',
        invoice_number: 'RE-2026-0001',
        draft_number: 'RE-D-1',
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
        pdf_archive_bucket: null,
        pdf_archive_key: null,
        pdf_archive_generation: null,
        pdf_archive_sha256: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [
          {
            id: 'line-1',
            tenant_id: 'tenant-1',
            invoice_id: 'inv-1',
            catalog_item_id: null,
            workshop_task_line_item_id: null,
            description: 'Service',
            quantity: new Prisma.Decimal('1.000'),
            unit_price: new Prisma.Decimal('100.00'),
            gross_unit_price: null,
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

  // AUT-1087 Scenario 1: 3 lines at 20% whose per-line rounded VAT differs from per-rate VAT by >= 0.01 EUR
  it('AUT-1087 S1: computes VAT per tax rate on summed net (half-up) and keeps line VAT informational', () => {
    const lineAllocations = [
      buildLineAllocation({
        id: 'line-1',
        unitPrice: new Prisma.Decimal('10.02'),
        taxRate: new Prisma.Decimal('20.00'),
      }),
      buildLineAllocation({
        id: 'line-2',
        unitPrice: new Prisma.Decimal('10.02'),
        taxRate: new Prisma.Decimal('20.00'),
      }),
      buildLineAllocation({
        id: 'line-3',
        unitPrice: new Prisma.Decimal('10.02'),
        taxRate: new Prisma.Decimal('20.00'),
      }),
    ];

    const snapshot = buildInvoiceSnapshotV2({
      invoice: buildInvoice(),
      seller,
      siteId: 'site-1',
      legalEntityId: seller.id,
      lineAllocations,
    });

    // Informational line VAT: 10.02 * 20% = 2.004 -> 2.00 per line (sum 6.00)
    expect(snapshot.items.map((item) => item.tax)).toEqual([
      '2.00',
      '2.00',
      '2.00',
    ]);
    // Per-rate VAT: half-up(30.06 * 20%) = half-up(6.012) = 6.01
    expect(snapshot.tax_breakdown).toEqual([
      { rate: '20.00', net: '30.06', tax: '6.01', gross: '36.07' },
    ]);
    expect(snapshot.total_net).toBe('30.06');
    expect(snapshot.total_tax).toBe('6.01');
    expect(snapshot.total_gross).toBe('36.07');

    const totals = computeStandardInvoiceTotals(lineAllocations);
    expect(totals.totalNet.toFixed(2)).toBe('30.06');
    expect(totals.totalTax.toFixed(2)).toBe('6.01');
    expect(totals.totalGross.toFixed(2)).toBe('36.07');
  });

  // AUT-1087 Scenario 2: lines at 20% and 10% produce one row per rate and VAT total is their sum
  it('AUT-1087 S2: computes per-rate tax_breakdown for 20% and 10% and sums rate taxes', () => {
    const lineAllocations = [
      buildLineAllocation({
        id: 'line-20-1',
        unitPrice: new Prisma.Decimal('10.02'),
        taxRate: new Prisma.Decimal('20.00'),
      }),
      buildLineAllocation({
        id: 'line-20-2',
        unitPrice: new Prisma.Decimal('10.02'),
        taxRate: new Prisma.Decimal('20.00'),
      }),
      buildLineAllocation({
        id: 'line-20-3',
        unitPrice: new Prisma.Decimal('10.02'),
        taxRate: new Prisma.Decimal('20.00'),
      }),
      buildLineAllocation({
        id: 'line-10-1',
        unitPrice: new Prisma.Decimal('10.04'),
        taxRate: new Prisma.Decimal('10.00'),
      }),
      buildLineAllocation({
        id: 'line-10-2',
        unitPrice: new Prisma.Decimal('10.04'),
        taxRate: new Prisma.Decimal('10.00'),
      }),
      buildLineAllocation({
        id: 'line-10-3',
        unitPrice: new Prisma.Decimal('10.04'),
        taxRate: new Prisma.Decimal('10.00'),
      }),
    ];

    const snapshot = buildInvoiceSnapshotV2({
      invoice: buildInvoice(),
      seller,
      siteId: 'site-1',
      legalEntityId: seller.id,
      lineAllocations,
    });

    expect(snapshot.tax_breakdown).toEqual([
      { rate: '10.00', net: '30.12', tax: '3.01', gross: '33.13' },
      { rate: '20.00', net: '30.06', tax: '6.01', gross: '36.07' },
    ]);
    expect(snapshot.total_net).toBe('60.18');
    expect(snapshot.total_tax).toBe('9.02');
    expect(snapshot.total_gross).toBe('69.20');
  });

  // AUT-1087 Anti-criterion 1: Decimal arithmetic only, no float rounding drift (1.005 * 100 = 100.49999999999999 in IEEE 754)
  it('AUT-1087 Anti-criterion 1: uses exact Decimal half-up rounding where binary float fails', () => {
    const lineAllocations = [
      buildLineAllocation({
        id: 'line-float-1',
        quantity: new Prisma.Decimal('1.000'),
        unitPrice: new Prisma.Decimal('3.35'),
        taxRate: new Prisma.Decimal('10.00'),
      }),
      buildLineAllocation({
        id: 'line-float-2',
        quantity: new Prisma.Decimal('1.000'),
        unitPrice: new Prisma.Decimal('3.35'),
        taxRate: new Prisma.Decimal('10.00'),
      }),
      buildLineAllocation({
        id: 'line-float-3',
        quantity: new Prisma.Decimal('1.000'),
        unitPrice: new Prisma.Decimal('3.35'),
        taxRate: new Prisma.Decimal('10.00'),
      }),
    ];

    // Combined net = 10.05 -> 10% = 1.005 -> Decimal half-up = 1.01 (float Math.round gives 1.00)
    const totals = computeStandardInvoiceTotals(lineAllocations);
    expect(totals.totalNet.toFixed(2)).toBe('10.05');
    expect(totals.totalTax.toFixed(2)).toBe('1.01');
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
    expect(snapshot.tax_breakdown).toEqual([]);
    expect(snapshot.items[0]?.tax).toBe('0.00');
    expect(snapshot.items[0]?.gross).toBe('15000.00');
    expect(snapshot.total_gross).toBe('15000.00');
    expect(snapshot.total_tax).toBe('0.00');
    expect(JSON.stringify(snapshot.items)).not.toContain('3000.00');
    expect(JSON.stringify(snapshot.items)).not.toContain('18000.00');
  });

  it('rejects margin-scheme snapshots when seller country is unsupported', () => {
    // Deliberately outside LegalEntityCountry: the builder must reject it.
    const unsupportedCountry: string = 'CH';
    expect(() =>
      buildInvoiceSnapshotV2({
        invoice: buildInvoice({
          tax_mode: InvoiceTaxMode.MARGIN_SCHEME,
          total_gross: new Prisma.Decimal('15000.00'),
        }),
        seller: {
          ...seller,
          country_iso: unsupportedCountry as LegalEntityCountry,
        },
        siteId: 'site-1',
        legalEntityId: seller.id,
        lineAllocations: [buildLineAllocation({ id: 'line-margin' })],
        margin: {
          cost_basis: '12000.00',
          margin_tax: '500.00',
          tax_rate: '20.00',
          calculation_profile: 'vehicle-margin-v1',
        },
      }),
    ).toThrow();
  });

  // AUT-1068 Scenario 2: snapshot day fields use Europe/Vienna calendar, not UTC
  it.each([
    {
      label: 'winter CET (UTC+1) 2027-01-01 00:30 Vienna (23:30 UTC)',
      date: '2026-12-31T23:30:00.000Z',
      dueDate: '2027-01-14T23:30:00.000Z',
      expectedDay: '2027-01-01',
      expectedDueDay: '2027-01-15',
    },
    {
      label: 'summer CEST (UTC+2) 2026-07-16 00:30 Vienna (22:30 UTC)',
      date: '2026-07-15T22:30:00.000Z',
      dueDate: '2026-07-29T22:30:00.000Z',
      expectedDay: '2026-07-16',
      expectedDueDay: '2026-07-30',
    },
  ])(
    'formats date, due_date and supply_date_* on the Europe/Vienna calendar for $label',
    ({ date, dueDate, expectedDay, expectedDueDay }) => {
      const instant = new Date(date);
      const snapshot = buildInvoiceSnapshotV2({
        invoice: buildInvoice({
          date: instant,
          due_date: new Date(dueDate),
          supply_date_from: null,
          supply_date_to: null,
        }),
        seller,
        siteId: 'site-1',
        legalEntityId: seller.id,
        lineAllocations: [buildLineAllocation()],
      });

      expect(snapshot.date).toBe(expectedDay);
      expect(snapshot.due_date).toBe(expectedDueDay);
      expect(snapshot.supply_date_from).toBe(expectedDay);
      expect(snapshot.supply_date_to).toBe(expectedDay);
    },
  );

  it('prefers customer payment_terms_days over seller payment_terms_days', () => {
    const snapshot = buildInvoiceSnapshotV2({
      invoice: buildInvoice({
        customer: {
          ...buildInvoice().customer,
          payment_terms_days: 30,
        },
      }),
      seller,
      siteId: 'site-1',
      legalEntityId: seller.id,
      lineAllocations: [buildLineAllocation()],
    });

    expect(snapshot.payment_terms.days).toBe(30);
  });

  it('throws 422 INVOICE_PAYMENT_TERMS_MISSING when neither customer nor seller has payment terms', () => {
    expect(() =>
      buildInvoiceSnapshotV2({
        invoice: buildInvoice({
          customer: {
            ...buildInvoice().customer,
            payment_terms_days: null,
          },
        }),
        seller: {
          ...seller,
          payment_terms_days: null as unknown as number,
        },
        siteId: 'site-1',
        legalEntityId: seller.id,
        lineAllocations: [buildLineAllocation()],
      }),
    ).toThrow('Payment terms days must be configured');
  });
});

describe('isInvoiceSnapshotV2 branding validation', () => {
  const baseSnapshot = {
    schema_version: 2,
    document_kind: 'INVOICE',
    template_version: 'invoice-pdf-v1',
    site_id: 'site-1',
    legal_entity_id: 'entity-1',
    currency: 'EUR',
    seller: { name: 'Example GmbH' },
    items: [{}],
    tax_breakdown: [],
    total_net: '100.00',
    total_tax: '20.00',
    total_gross: '120.00',
    snapshot_created_at: '2026-09-28T12:00:00.000Z',
  };

  const defaultBranding = {
    schema_version: 1,
    profile_id: null,
    profile_revision: 0,
    preset_id: 'standard-v1',
    renderer_version: 'invoice-brand-v1',
    font_id: 'acp-sans-v1',
    tokens: {
      primary_color: '#111827',
      secondary_color: '#E5E7EB',
      header_band: 'none',
      footer_band: 'none',
      header_text: '',
      footer_text: '',
    },
    logo: null,
    resolved_at: '2026-09-28T12:00:00.000Z',
  };

  const confirmedBranding = {
    ...defaultBranding,
    profile_id: '8f507f3d-40e1-47c9-a451-73a2682c8b17',
    profile_revision: 4,
    tokens: {
      ...defaultBranding.tokens,
      header_text: 'Example GmbH',
    },
    logo: {
      asset_id: '3b825bc1-dcc9-4f2e-91fc-1b9905e6ba2e',
      bucket: 'private-branding',
      key: 'tenant/entity/logo.png',
      generation: '1730000000000000',
      sha256: 'a'.repeat(64),
      mime_type: 'image/png',
      width: 640,
      height: 240,
    },
  };

  it.each([
    ['ACP defaults with revision zero', defaultBranding],
    ['a confirmed profile and exact logo generation', confirmedBranding],
  ])('accepts %s', (_description, branding) => {
    expect(
      isInvoiceSnapshotV2({
        ...baseSnapshot,
        template_version: 'invoice-brand-v1',
        branding,
      }),
    ).toBe(true);
  });

  it.each([
    [
      'malformed nested tokens',
      { ...defaultBranding, tokens: { ...defaultBranding.tokens, header_band: 'html' } },
    ],
    [
      'low-contrast primary color',
      {
        ...defaultBranding,
        tokens: { ...defaultBranding.tokens, primary_color: '#FFFFFF' },
      },
    ],
    [
      'malformed exact logo metadata',
      {
        ...confirmedBranding,
        logo: { ...confirmedBranding.logo, sha256: 'not-a-hash' },
      },
    ],
    ['an unknown branding schema version', { ...defaultBranding, schema_version: 2 }],
  ])('rejects %s', (_description, branding) => {
    expect(
      isInvoiceSnapshotV2({
        ...baseSnapshot,
        template_version: 'invoice-brand-v1',
        branding,
      }),
    ).toBe(false);
  });

  it('rejects invoice-brand-v1 when its required branding object is absent', () => {
    expect(
      isInvoiceSnapshotV2({
        ...baseSnapshot,
        template_version: 'invoice-brand-v1',
      }),
    ).toBe(false);
  });

  it('continues to accept historical V2 snapshots without branding', () => {
    expect(isInvoiceSnapshotV2(baseSnapshot)).toBe(true);
  });
});

type InvoiceInput = Parameters<typeof buildInvoiceSnapshotV2>[0]['invoice'];

function buildInvoice(overrides: Partial<InvoiceInput> = {}): InvoiceInput {
  return {
    id: 'inv-1',
    tenant_id: 'tenant-1',
    invoice_number: 'RE-2026-0001',
    draft_number: 'RE-D-1',
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
    pdf_archive_bucket: null,
    pdf_archive_key: null,
    pdf_archive_generation: null,
    pdf_archive_sha256: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [],
    customer: customerRow({
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
    }),
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
