import { toRenderableCreditNoteSnapshot } from './credit-note-snapshot-render.adapter.js';

describe('toRenderableCreditNoteSnapshot', () => {
  const snapshot = {
    schema_version: 2,
    document_kind: 'CREDIT_NOTE',
    credit_title: 'Stornorechnung',
    template_version: '2026-09-20',
    country_profile_version: '2026-09-20',
    site_id: 'site-1',
    legal_entity_id: 'legal-1',
    currency: 'EUR',
    seller: {
      name: 'Example GmbH',
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
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane@example.com',
      phone: null,
      vat_id: null,
      address_street: 'Kundenstraße 2',
      address_city: 'Berlin',
      address_zip: '10117',
      address_country: 'DE',
    },
    vehicle: null,
    date: '2026-09-22',
    due_date: '2026-09-22',
    supply_date_from: '2026-09-21',
    supply_date_to: '2026-09-21',
    payment_terms: { days: 14, text: '14 Tage netto' },
    items: [
      {
        id: 'line-1',
        description: 'Oil Filter',
        quantity: '2.000',
        unit_price: '50.00',
        tax_rate: '20.00',
        line_discount_type: null,
        line_discount_value: null,
        net: '100.00',
        tax: '20.00',
        gross: '120.00',
        revenue_group_name: 'Parts',
        accounting_allocation: null,
      },
    ],
    tax_breakdown: [
      { rate: '20.00', net: '100.00', tax: '20.00', gross: '120.00' },
    ],
    total_net: '100.00',
    total_tax: '20.00',
    total_gross: '120.00',
    notes: null,
    tax_mode: 'STANDARD',
    snapshot_created_at: '2026-09-22T10:00:00.000Z',
    original_document: {
      id: 'invoice-1',
      number: 'RE-2026-0042',
      date: '2026-09-21',
      reason: 'Wrong quantity billed',
      snapshot_version: 2,
    },
  };

  it('maps credit note snapshots for PDF rendering', () => {
    const renderable = toRenderableCreditNoteSnapshot(
      snapshot,
      'CN-2026-0001',
      'credit-1',
    );

    expect(renderable).toMatchObject({
      id: 'credit-1',
      invoice_number: 'CN-2026-0001',
      document_kind: 'CREDIT_NOTE',
      credit_title: 'Stornorechnung',
      original_document: snapshot.original_document,
      total_gross: '120.00',
    });
  });
});
