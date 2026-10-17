import { extractVisibleTextFromHtml } from '../common/pdf/pdf-html-text.js';
import { escapeHtml } from '../common/pdf/pdf-layout.js';
import { I18N_TRANSLATION_BUNDLE_VERSION } from '../common/i18n/display-language.js';
import { createInvoicePdfDateFormatter } from './invoice-pdf-date-format.helpers.js';
import { resolveInvoicePdfLayoutContext } from './invoice-pdf-layout-context.js';
import { buildInvoiceHtmlDocumentForSnapshot } from './invoice-pdf-localized.layout.js';
import type { InvoiceSnapshot } from './invoice-snapshot.js';

describe('invoice-pdf.layout golden text', () => {
  const createV2Snapshot = (): InvoiceSnapshot => ({
    schema_version: 2,
    document_kind: 'INVOICE',
    id: 'inv-1',
    invoice_number: 'RE-2026-0042',
    date: '2026-04-07',
    due_date: '2026-04-21',
    total_net: '100.00',
    total_tax: '20.00',
    total_gross: '120.00',
    notes: null,
    tax_mode: 'STANDARD',
    seller: {
      name: 'E2E GmbH',
      country_iso: 'AT',
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
    },
    customer: {
      type: 'PRIVATE',
      company_name: null,
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: null,
      phone: null,
      vat_id: null,
      address_street: 'Kundenstraße 2',
      address_city: 'Wien',
      address_zip: '1020',
      address_country: 'AT',
    },
    vehicle: null,
    items: [
      {
        description: 'Service',
        quantity: '1',
        unit_price: '100.00',
        tax_rate: '20',
        line_discount_type: null,
        line_discount_value: null,
        line_total: '100.00',
        revenue_group_name: null,
      },
    ],
    snapshot_created_at: '2026-04-07T12:00:00.000Z',
  });

  it('keeps legacy German labels when document_locale is absent', () => {
    const snapshot = createV2Snapshot();
    const html = buildInvoiceHtmlDocumentForSnapshot(
      snapshot,
      'RE-2026-0042',
      escapeHtml,
      createInvoicePdfDateFormatter(snapshot),
      null,
    );
    const text = extractVisibleTextFromHtml(html);
    expect(text).toContain('Rechnung');
    expect(text).toContain('Rechnungsempfänger');
  });

  it('renders English labels for localized EN snapshots', () => {
    const snapshot: InvoiceSnapshot = {
      ...createV2Snapshot(),
      document_locale: 'en',
      format_locale: 'de-AT',
      translation_bundle_version: I18N_TRANSLATION_BUNDLE_VERSION,
      legal_text_version: null,
    };
    const html = buildInvoiceHtmlDocumentForSnapshot(
      snapshot,
      'RE-2026-0042',
      escapeHtml,
      createInvoicePdfDateFormatter(snapshot),
      resolveInvoicePdfLayoutContext(snapshot),
    );
    const text = extractVisibleTextFromHtml(html);
    expect(text).toContain('Invoice');
    expect(text).toContain('Invoice recipient');
    expect(text).toContain(
      'The German version of the legal texts is authoritative',
    );
  });
});
