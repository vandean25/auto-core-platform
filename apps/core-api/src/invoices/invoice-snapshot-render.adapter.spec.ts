import { toRenderableInvoiceSnapshot } from './invoice-snapshot-render.adapter.js';

describe('toRenderableInvoiceSnapshot', () => {
  const v2Snapshot = {
    schema_version: 2,
    document_kind: 'INVOICE',
    site_id: 'site-1',
    legal_entity_id: 'le-1',
    currency: 'EUR',
    seller: {
      name: 'E2E GmbH',
      country_iso: 'DE',
      address_street: 'Hauptstraße 1',
      address_line2: null,
      address_zip: '10115',
      address_city: 'Berlin',
      tax_number: '27/123/45678',
      vat_id: 'DE123456789',
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
      type: 'PRIVATE',
      company_name: null,
      first_name: 'Max',
      last_name: 'Mustermann',
      email: null,
      phone: null,
      vat_id: null,
      address_street: 'Kundenstraße 2',
      address_city: 'Wien',
      address_zip: '1020',
      address_country: 'AT',
    },
    vehicle: null,
    date: '2026-09-20',
    due_date: '2026-10-04',
    supply_date_from: '2026-09-20',
    supply_date_to: '2026-09-20',
    payment_terms: {
      days: 14,
      text: 'Zahlbar innerhalb von 14 Tagen.',
    },
    items: [
      {
        id: 'line-1',
        description: 'Service',
        quantity: '1.000',
        unit_price: '100.00',
        tax_rate: '20.00',
        line_discount_type: null,
        line_discount_value: null,
        net: '100.00',
        tax: '20.00',
        gross: '120.00',
        revenue_group_name: 'Sales',
        accounting_allocation: {
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
          countryIso: 'DE',
          currency: 'EUR',
        },
      },
    ],
    tax_breakdown: [{ rate: '20.00', net: '100.00', tax: '20.00', gross: '120.00' }],
    total_net: '100.00',
    total_tax: '20.00',
    total_gross: '120.00',
    notes: null,
    tax_mode: 'STANDARD',
    snapshot_created_at: '2026-09-20T12:00:00.000Z',
  };

  it('maps v2 snapshot presentation fields for PDF rendering', () => {
    const renderable = toRenderableInvoiceSnapshot(
      v2Snapshot,
      'RE-2026-0001',
      'inv-1',
    );

    expect(renderable).not.toBeNull();
    expect(renderable?.schema_version).toBe(2);
    expect(renderable?.seller?.name).toBe('E2E GmbH');
    expect(renderable?.supply_date_from).toBe('2026-09-20');
    expect(renderable?.payment_terms?.text).toBe(
      'Zahlbar innerhalb von 14 Tagen.',
    );
    expect(renderable?.items[0].line_total).toBe('120.00');
    expect(renderable?.tax_breakdown?.[0].gross).toBe('120.00');
  });

  it('returns null for non-v2 snapshots', () => {
    expect(
      toRenderableInvoiceSnapshot({ schema_version: 1 }, 'RE-1', 'inv-1'),
    ).toBeNull();
  });

  it('omits tax_breakdown for margin-scheme snapshots', () => {
    const renderable = toRenderableInvoiceSnapshot(
      {
        ...v2Snapshot,
        tax_mode: 'MARGIN_SCHEME',
        tax_breakdown: [{ rate: '20.00', net: '15000.00', tax: '3000.00', gross: '18000.00' }],
        total_gross: '15000.00',
        total_tax: '0.00',
        items: [
          {
            ...v2Snapshot.items[0],
            net: '15000.00',
            tax: '0.00',
            gross: '15000.00',
          },
        ],
        margin: {
          cost_basis: '12000.00',
          margin_tax: '500.00',
          tax_rate: '20.00',
          calculation_profile: 'vehicle-margin-v1',
        },
      },
      'RE-2026-0002',
      'inv-2',
    );

    expect(renderable?.tax_breakdown).toBeUndefined();
    expect(renderable?.items[0].line_total).toBe('15000.00');
  });
});
