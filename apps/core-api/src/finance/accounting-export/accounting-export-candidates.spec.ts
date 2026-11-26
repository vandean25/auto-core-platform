import { InvoiceTaxMode } from '@prisma/client';
import { DATEV_ALLOCATION_RULES } from './accounting-export-allocation-rules.js';
import { buildCreditRows, buildInvoiceRows } from './accounting-export-booking-rows.js';
import { computeSignedTotals } from './accounting-export-candidates.js';
import type { AccountingExportBookingRow } from './accounting-export.types.js';

describe('computeSignedTotals', () => {
  const baseRow = (
    overrides: Partial<AccountingExportBookingRow>,
  ): AccountingExportBookingRow => ({
    documentId: 'doc-1',
    documentKind: 'INVOICE',
    documentNumber: 'RE-1',
    documentDate: '2026-01-10',
    lineId: 'line-1',
    polarity: 'S',
    net: '100.00',
    tax: '20.00',
    taxRate: '20.00',
    gross: '120.00',
    debtorAccount: '1000',
    revenueAccount: '8400',
    buKey: null,
    bookingText: 'RE RE-1',
    ...overrides,
  });

  it('buckets signed totals by revenue account and frozen tax rate', () => {
    const totals = computeSignedTotals([
      baseRow({ lineId: 'line-1', taxRate: '20.00', net: '100.00', tax: '20.00', gross: '120.00' }),
      baseRow({
        lineId: 'line-2',
        taxRate: '7.00',
        net: '50.00',
        tax: '3.50',
        gross: '53.50',
      }),
      baseRow({
        documentKind: 'CREDIT_NOTE',
        lineId: 'line-3',
        polarity: 'H',
        taxRate: '20.00',
        net: '100.00',
        tax: '20.00',
        gross: '120.00',
      }),
    ]);

    expect(totals).toEqual([
      {
        account: '8400',
        taxRate: '20.00',
        net: '0.00',
        tax: '0.00',
        gross: '0.00',
      },
      {
        account: '8400',
        taxRate: '7.00',
        net: '50.00',
        tax: '3.50',
        gross: '53.50',
      },
    ]);
  });
});

describe('AUT-1087: accounting export booking rows use per-rate VAT, not informational line VAT', () => {
  const allocation = {
    profileCode: 'ACP-DATEV-DE-EUR-1',
    profileVersion: 1,
    sourceCategoryKey: 'parts',
    sourceCategoryLabel: 'Parts',
    revenueAccount: '8400',
    debtorAccount: '1000',
    taxMode: 'STANDARD' as const,
    taxRate: '20.00',
    taxTreatment: 'automatic' as const,
    buKey: null,
    countryIso: 'DE' as const,
    currency: 'EUR' as const,
  };

  const makeLine = (id: string) => ({
    id,
    description: 'Part',
    quantity: '1.000',
    unit_price: '10.02',
    tax_rate: '20.00',
    line_discount_type: null,
    line_discount_value: null,
    net: '10.02',
    tax: '2.00',
    gross: '12.02',
    revenue_group_name: 'Parts',
    accounting_allocation: allocation,
  });

  const baseSnapshot = (tax: string, gross: string) => ({
    schema_version: 2 as const,
    document_kind: 'INVOICE' as const,
    template_version: 'invoice-pdf-v1',
    country_profile_version: 'legal-invoicing-v1',
    site_id: 'site-1',
    legal_entity_id: 'le-1',
    currency: 'EUR' as const,
    seller: {
      name: 'Garage GmbH',
      country_iso: 'DE' as const,
      address_street: 'Str 1',
      address_line2: null,
      address_zip: '10115',
      address_city: 'Berlin',
      tax_number: '12/345/67890',
      vat_id: null,
      iban: null,
      bic: null,
      bank_name: null,
      email: null,
      phone: null,
      registration_number: null,
      registration_court: null,
      representatives: null,
    },
    customer: {
      type: 'PRIVATE' as const,
      company_name: null,
      first_name: 'Max',
      last_name: 'Muster',
      email: null,
      phone: null,
      vat_id: null,
      address_street: 'Str 2',
      address_city: 'Berlin',
      address_zip: '10115',
      address_country: 'DE',
    },
    vehicle: null,
    date: '2026-10-01',
    due_date: '2026-10-15',
    supply_date_from: '2026-10-01',
    supply_date_to: '2026-10-01',
    payment_terms: { days: 14, text: '14 days' },
    items: [makeLine('l1'), makeLine('l2'), makeLine('l3')],
    tax_breakdown: [{ rate: '20.00', net: '30.06', tax, gross }],
    total_net: '30.06',
    total_tax: tax,
    total_gross: gross,
    notes: null,
    tax_mode: InvoiceTaxMode.STANDARD,
    snapshot_created_at: '2026-10-01T10:00:00.000Z',
  });

  it('AUT-1087 Anti-criterion 3: exports per-rate VAT (6.01 / 36.07) instead of informational line VAT sum (6.00 / 36.06)', () => {
    const rows = buildInvoiceRows(
      {
        id: 'inv-1',
        invoice_number: 'RE-2026-0001',
        snapshot: baseSnapshot('6.01', '36.07'),
        items: [
          { id: 'l1', accounting_snapshot: allocation },
          { id: 'l2', accounting_snapshot: allocation },
          { id: 'l3', accounting_snapshot: allocation },
        ],
      },
      '2026-10-01',
      DATEV_ALLOCATION_RULES,
    );

    const totals = computeSignedTotals(rows);
    expect(totals).toEqual([
      {
        account: '8400',
        taxRate: '20.00',
        net: '30.06',
        tax: '6.01',
        gross: '36.07',
      },
    ]);
  });

  it('AUT-1087 Anti-criterion 2: keeps pre-change issued invoice export totals unchanged (6.00 / 36.06)', () => {
    const rows = buildInvoiceRows(
      {
        id: 'inv-old',
        invoice_number: 'RE-2026-0000',
        snapshot: baseSnapshot('6.00', '36.06'),
        items: [
          { id: 'l1', accounting_snapshot: allocation },
          { id: 'l2', accounting_snapshot: allocation },
          { id: 'l3', accounting_snapshot: allocation },
        ],
      },
      '2026-10-01',
      DATEV_ALLOCATION_RULES,
    );

    const totals = computeSignedTotals(rows);
    expect(totals).toEqual([
      {
        account: '8400',
        taxRate: '20.00',
        net: '30.06',
        tax: '6.00',
        gross: '36.06',
      },
    ]);
  });

  it('AUT-1087: exports credit note per-rate VAT (6.01 / 36.07) when snapshot tax_breakdown is per-rate', () => {
    const inv = baseSnapshot('6.01', '36.07');
    const cnSnapshot = {
      ...inv,
      document_kind: 'CREDIT_NOTE' as const,
      credit_title: 'Stornorechnung' as const,
      original_document: {
        id: 'inv-1',
        number: 'RE-2026-0001',
        date: '2026-10-01',
        reason: 'Full cancellation',
        snapshot_version: 2,
      },
    };

    const rows = buildCreditRows(
      {
        id: 'cn-1',
        credit_number: 'CN-2026-0001',
        snapshot: cnSnapshot,
      },
      DATEV_ALLOCATION_RULES,
    );

    const totals = computeSignedTotals(rows);
    expect(totals).toEqual([
      {
        account: '8400',
        taxRate: '20.00',
        net: '-30.06',
        tax: '-6.01',
        gross: '-36.07',
      },
    ]);
  });
});
