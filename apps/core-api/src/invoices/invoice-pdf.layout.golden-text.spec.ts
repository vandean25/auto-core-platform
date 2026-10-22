import { extractVisibleTextFromHtml } from '../common/pdf/pdf-html-text.js';
import { escapeHtml } from '../common/pdf/pdf-layout.js';
import {
  I18N_TRANSLATION_BUNDLE_VERSION,
  type DisplayLanguage,
} from '../common/i18n/display-language.js';
import {
  LEGACY_I18N_TRANSLATION_BUNDLE_VERSION,
} from '../common/i18n/pdf-resource-bundle.js';
import {
  loadPdfLocaleJson,
  pdfLocaleString,
} from '../common/i18n/pdf-locale-test-helpers.js';
import { createInvoicePdfDateFormatter } from './invoice-pdf-date-format.helpers.js';
import { resolveInvoicePdfLayoutContext } from './invoice-pdf-layout-context.js';
import { buildInvoiceHtmlDocumentForSnapshot } from './invoice-pdf-localized.layout.js';
import {
  buildInvoiceFooterTemplate,
  buildInvoiceHtmlDocument,
} from './invoice-pdf.layout.js';
import type { InvoiceSnapshot } from './invoice-snapshot.js';

describe('invoice-pdf.layout golden text', () => {
  const dePdf = loadPdfLocaleJson('de');
  const enPdf = loadPdfLocaleJson('en');

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
    notes: 'Please pay within 14 days.',
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
    vehicle: {
      make: 'Demo',
      model: 'City',
      year: 2020,
      engine_code: null,
      plate: 'W-12345A',
      vin: 'VIN00000000000001',
    },
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
    tax_breakdown: [{ rate: '20', net: '100.00', tax: '20.00', gross: '120.00' }],
    snapshot_created_at: '2026-04-07T12:00:00.000Z',
  });

  const renderInvoice = (
    snapshot: InvoiceSnapshot,
    locale?: DisplayLanguage,
  ): string => {
    const withLocale =
      locale === undefined
        ? snapshot
        : {
            ...snapshot,
            document_locale: locale,
            format_locale: 'de-AT' as const,
            translation_bundle_version: I18N_TRANSLATION_BUNDLE_VERSION,
            legal_text_version: null,
          };
    const ctx = resolveInvoicePdfLayoutContext(withLocale);
    return buildInvoiceHtmlDocumentForSnapshot(
      withLocale,
      'RE-2026-0042',
      escapeHtml,
      createInvoicePdfDateFormatter(withLocale),
      ctx,
    );
  };

  it('keeps legacy German labels when document_locale is absent', () => {
    const snapshot = createV2Snapshot();
    const text = extractVisibleTextFromHtml(renderInvoice(snapshot));
    expect(text).toContain('Rechnung');
    expect(text).toContain('Rechnungsempfänger');
    expect(text).toContain(pdfLocaleString(dePdf, 'invoice.taxBreakdownTitle'));
  });

  it('re-renders pre-resources-v1 snapshots on the legacy path with identical text', () => {
    const snapshot: InvoiceSnapshot = {
      ...createV2Snapshot(),
      document_locale: 'de',
      format_locale: 'de-AT',
      translation_bundle_version: LEGACY_I18N_TRANSLATION_BUNDLE_VERSION,
      legal_text_version: null,
    };
    expect(resolveInvoicePdfLayoutContext(snapshot)).toBeNull();
    const legacyHtml = buildInvoiceHtmlDocument(
      snapshot,
      'RE-2026-0042',
      escapeHtml,
      createInvoicePdfDateFormatter(snapshot),
    );
    const rerenderHtml = buildInvoiceHtmlDocumentForSnapshot(
      snapshot,
      'RE-2026-0042',
      escapeHtml,
      createInvoicePdfDateFormatter(snapshot),
      null,
    );
    expect(extractVisibleTextFromHtml(rerenderHtml)).toBe(
      extractVisibleTextFromHtml(legacyHtml),
    );
    expect(extractVisibleTextFromHtml(legacyHtml)).toContain(
      pdfLocaleString(dePdf, 'invoice.taxBreakdownTitle'),
    );
  });

  it('renders localized DE labels from pdf.json including tax breakdown', () => {
    const text = extractVisibleTextFromHtml(renderInvoice(createV2Snapshot(), 'de'));
    expect(text).toContain(pdfLocaleString(dePdf, 'invoice.title'));
    expect(text).toContain(pdfLocaleString(dePdf, 'invoice.recipientLabel'));
    expect(text).toContain(pdfLocaleString(dePdf, 'invoice.vehicleSectionTitle'));
    expect(text).toContain(pdfLocaleString(dePdf, 'invoice.plateLabel'));
    expect(text).toContain(pdfLocaleString(dePdf, 'invoice.notesTitle'));
    expect(text).toContain(pdfLocaleString(dePdf, 'invoice.taxBreakdownTitle'));
  });

  it('renders English labels and footer title from pdf.json', () => {
    const snapshot = {
      ...createV2Snapshot(),
      document_locale: 'en' as const,
      format_locale: 'de-AT' as const,
      translation_bundle_version: I18N_TRANSLATION_BUNDLE_VERSION,
      legal_text_version: null,
    };
    const text = extractVisibleTextFromHtml(renderInvoice(snapshot, 'en'));
    expect(text).toContain(pdfLocaleString(enPdf, 'invoice.title'));
    expect(text).toContain(pdfLocaleString(enPdf, 'invoice.recipientLabel'));
    expect(text).toContain(pdfLocaleString(enPdf, 'invoice.vehicleSectionTitle'));
    expect(text).toContain(pdfLocaleString(enPdf, 'invoice.notesTitle'));
    expect(text).toContain(pdfLocaleString(enPdf, 'invoice.taxBreakdownTitle'));
    expect(text).toContain(pdfLocaleString(enPdf, 'legal.authoritativeGermanNotice'));

    const footer = buildInvoiceFooterTemplate(
      'RE-2026-0042',
      escapeHtml,
      snapshot,
      '',
      pdfLocaleString(enPdf, 'invoice.title'),
    );
    expect(extractVisibleTextFromHtml(footer)).toContain(
      pdfLocaleString(enPdf, 'invoice.title'),
    );
  });
});
