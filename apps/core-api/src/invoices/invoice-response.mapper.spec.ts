import { InvoiceTaxMode } from '@prisma/client';
import { omitInvoiceSnapshot } from './invoice-response.mapper.js';
import { MARGIN_SCHEME_LEGAL_NOTES } from './margin-scheme-legal-notes.js';

const marginV2SnapshotBase = {
  schema_version: 2,
  document_kind: 'INVOICE',
  template_version: 'invoice-pdf-v1',
  country_profile_version: 'legal-invoicing-v1',
  site_id: 'site-1',
  legal_entity_id: 'le-1',
  currency: 'EUR',
  customer: {
    type: 'PRIVATE',
    company_name: null,
    first_name: 'Max',
    last_name: 'Mustermann',
    email: null,
    phone: null,
    vat_id: null,
    address_street: 'Kundenstraße 2',
    address_city: 'Berlin',
    address_zip: '10117',
    address_country: 'DE',
  },
  vehicle: null,
  date: '2026-09-20',
  due_date: '2026-10-04',
  supply_date_from: '2026-09-20',
  supply_date_to: '2026-09-20',
  payment_terms: { days: 14, text: '14 Tage netto' },
  items: [
    {
      id: 'line-1',
      description: 'Used vehicle',
      quantity: '1.000',
      unit_price: '15000.00',
      tax_rate: '0.00',
      line_discount_type: null,
      line_discount_value: null,
      net: '15000.00',
      tax: '0.00',
      gross: '15000.00',
      revenue_group_name: 'Vehicle used (margin)',
      accounting_allocation: null,
    },
  ],
  tax_breakdown: [],
  total_net: '15000.00',
  total_tax: '0.00',
  total_gross: '15000.00',
  notes: null,
  tax_mode: 'MARGIN_SCHEME',
  snapshot_created_at: '2026-09-20T12:00:00.000Z',
};

describe('omitInvoiceSnapshot', () => {
  it('does not expose private snapshot data in an API response', () => {
    const response = omitInvoiceSnapshot({
      id: 'invoice-1',
      status: 'FINALIZED',
      snapshot: {
        branding: {
          logo: {
            bucket: 'private-bucket',
            key: 'private/object.png',
            generation: '123',
          },
        },
      },
    });

    expect(response).toEqual({ id: 'invoice-1', status: 'FINALIZED' });
    expect(JSON.stringify(response)).not.toContain('private-bucket');
    expect(JSON.stringify(response)).not.toContain('private/object.png');
  });

  it('does not expose archive or legacy storage locators in an API response', () => {
    const response = omitInvoiceSnapshot({
      id: 'invoice-1',
      status: 'ISSUED',
      snapshot: { private: 'snapshot-value' },
      pdf_archive_bucket: 'private-archive-bucket',
      pdf_archive_key: 'private/archive/key.pdf',
      pdf_archive_generation: 'private-generation',
      pdf_archive_sha256: 'private-hash',
      pdf_storage_bucket: 'private-legacy-bucket',
      pdf_storage_key: 'private/legacy/key.pdf',
    });

    const serialized = JSON.stringify(response);
    expect(response).toEqual({ id: 'invoice-1', status: 'ISSUED' });
    expect(serialized).not.toContain('snapshot');
    expect(serialized).not.toContain('private-archive-bucket');
    expect(serialized).not.toContain('private/archive/key.pdf');
    expect(serialized).not.toContain('private-generation');
    expect(serialized).not.toContain('private-hash');
    expect(serialized).not.toContain('private-legacy-bucket');
    expect(serialized).not.toContain('private/legacy/key.pdf');
  });

  it('adds DE margin_scheme_legal_note from v2 snapshot seller country only', () => {
    const response = omitInvoiceSnapshot({
      id: 'invoice-de-margin',
      tax_mode: InvoiceTaxMode.MARGIN_SCHEME,
      snapshot: {
        ...marginV2SnapshotBase,
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
      },
    });

    expect(response.margin_scheme_legal_note).toBe(
      MARGIN_SCHEME_LEGAL_NOTES.DE,
    );
    expect(response.margin_scheme_legal_note).toContain('§ 25a UStG');
    expect(response.margin_scheme_legal_note).not.toContain('§ 24 UStG');
  });

  it('adds AT margin_scheme_legal_note from v2 snapshot seller country only', () => {
    const response = omitInvoiceSnapshot({
      id: 'invoice-at-margin',
      tax_mode: InvoiceTaxMode.MARGIN_SCHEME,
      snapshot: {
        ...marginV2SnapshotBase,
        seller: {
          name: 'Example GmbH',
          country_iso: 'AT',
          address_street: 'Hauptstraße 1',
          address_line2: null,
          address_zip: '1010',
          address_city: 'Wien',
          tax_number: '123/4567',
          vat_id: 'ATU12345678',
          iban: null,
          bic: null,
          bank_name: null,
          email: null,
          phone: null,
          registration_number: null,
          registration_court: null,
          representatives: null,
        },
      },
    });

    expect(response.margin_scheme_legal_note).toBe(
      MARGIN_SCHEME_LEGAL_NOTES.AT,
    );
    expect(response.margin_scheme_legal_note).toContain('§ 24 UStG 1994');
    expect(response.margin_scheme_legal_note).not.toContain('§ 25a');
  });

  it('omits margin_scheme_legal_note without snapshot seller even if legal_entity is DE', () => {
    const response = omitInvoiceSnapshot({
      id: 'invoice-legacy-margin',
      tax_mode: InvoiceTaxMode.MARGIN_SCHEME,
      snapshot: { schema_version: 1, tax_mode: 'MARGIN_SCHEME' },
      legal_entity: { country_iso: 'DE' },
    });

    expect(response).not.toHaveProperty('margin_scheme_legal_note');
  });
});
