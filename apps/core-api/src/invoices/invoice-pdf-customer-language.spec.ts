import { extractVisibleTextFromHtml } from '../common/pdf/pdf-html-text.js';
import { escapeHtml } from '../common/pdf/pdf-layout.js';
import {
  DEFAULT_FORMAT_LOCALE,
  I18N_TRANSLATION_BUNDLE_VERSION,
  type DisplayLanguage,
} from '../common/i18n/display-language.js';
import {
  loadPdfLocaleJson,
  pdfLocaleString,
} from '../common/i18n/pdf-locale-test-helpers.js';
import { toRenderableCreditNoteSnapshot } from '../credit-notes/credit-note-snapshot-render.adapter.js';
import { createInvoicePdfDateFormatter } from './invoice-pdf-date-format.helpers.js';
import { resolveInvoicePdfLayoutContext } from './invoice-pdf-layout-context.js';
import { buildInvoiceHtmlDocumentForSnapshot } from './invoice-pdf-localized.layout.js';
import { buildInvoicePdfOptions } from './invoice-pdf-render-options.helpers.js';
import { toRenderableInvoiceSnapshot } from './invoice-snapshot-render.adapter.js';
import type { InvoiceSnapshot } from './invoice-snapshot.js';

const dePdf = loadPdfLocaleJson('de');
const enPdf = loadPdfLocaleJson('en');

/**
 * A committed invoice snapshot as the resolver stores it: two German lines, the second over
 * EUR 1.000 so the Austrian thousands separator is visible (AUT-719 regression coverage).
 */
function committedInvoice(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 2,
    document_kind: 'INVOICE',
    site_id: 'site-1',
    legal_entity_id: 'le-1',
    currency: 'EUR',
    seller: {
      name: 'Werkstatt GmbH',
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
      first_name: 'QA',
      last_name: 'Kundin',
      email: null,
      phone: null,
      vat_id: null,
      address_street: 'Kundenstraße 2',
      address_city: 'Wien',
      address_zip: '1020',
      address_country: 'AT',
    },
    vehicle: null,
    date: '2026-10-05',
    due_date: '2026-10-19',
    supply_date_from: '2026-10-05',
    supply_date_to: '2026-10-05',
    payment_terms: { days: 14, text: 'Zahlbar innerhalb von 14 Tagen.' },
    items: [
      {
        id: 'line-1',
        description: 'Inspektion',
        quantity: '1.500',
        unit_price: '120.00',
        tax_rate: '20.00',
        line_discount_type: null,
        line_discount_value: null,
        net: '180.00',
        tax: '36.00',
        gross: '216.00',
        revenue_group_name: 'Service',
        accounting_allocation: null,
      },
      {
        id: 'line-2',
        description: 'Reifensatz',
        quantity: '1.000',
        unit_price: '1234.56',
        tax_rate: '20.00',
        line_discount_type: null,
        line_discount_value: null,
        net: '1234.56',
        tax: '246.91',
        gross: '1481.47',
        revenue_group_name: 'Parts',
        accounting_allocation: null,
      },
    ],
    tax_breakdown: [
      { rate: '20.00', net: '1414.56', tax: '282.91', gross: '1697.47' },
    ],
    total_net: '1414.56',
    total_tax: '282.91',
    total_gross: '1697.47',
    notes: null,
    tax_mode: 'STANDARD',
    snapshot_created_at: '2026-10-05T12:00:00.000Z',
    ...overrides,
  };
}

function localeFields(locale: DisplayLanguage) {
  return {
    document_locale: locale,
    format_locale: DEFAULT_FORMAT_LOCALE,
    translation_bundle_version: I18N_TRANSLATION_BUNDLE_VERSION,
    legal_text_version: null,
  };
}

/** Runs a committed snapshot through the production render adapter, then renders its HTML. */
function renderCommittedInvoice(
  committed: Record<string, unknown>,
  number: string,
): {
  html: string;
  text: string;
  footerText: string;
  renderable: InvoiceSnapshot | null;
} {
  const renderable = toRenderableInvoiceSnapshot(committed, number, 'inv-1');
  if (!renderable) {
    throw new Error('Expected a renderable invoice snapshot.');
  }
  const ctx = resolveInvoicePdfLayoutContext(renderable);
  const html = buildInvoiceHtmlDocumentForSnapshot(
    renderable,
    number,
    escapeHtml,
    createInvoicePdfDateFormatter(renderable),
    ctx,
  );
  const options = buildInvoicePdfOptions({
    snapshot: renderable,
    invoiceNumber: number,
    branded: false,
    logoDataUrl: null,
    fontFaceCss: '',
  });
  return {
    html,
    text: extractVisibleTextFromHtml(html),
    footerText: extractVisibleTextFromHtml(options.footerTemplate ?? ''),
    renderable,
  };
}

function renderCommittedCreditNote(
  committed: Record<string, unknown>,
  number: string,
): { text: string; footerText: string } {
  const renderable = toRenderableCreditNoteSnapshot(committed, number, 'cn-1');
  if (!renderable) {
    throw new Error('Expected a renderable credit-note snapshot.');
  }
  const ctx = resolveInvoicePdfLayoutContext(renderable);
  const html = buildInvoiceHtmlDocumentForSnapshot(
    renderable,
    number,
    escapeHtml,
    createInvoicePdfDateFormatter(renderable),
    ctx,
  );
  const options = buildInvoicePdfOptions({
    snapshot: renderable,
    invoiceNumber: number,
    branded: false,
    logoDataUrl: null,
    fontFaceCss: '',
  });
  return {
    text: extractVisibleTextFromHtml(html),
    footerText: extractVisibleTextFromHtml(options.footerTemplate ?? ''),
  };
}

function committedCreditNote(
  locale: DisplayLanguage,
  isFullCredit: boolean,
): Record<string, unknown> {
  return committedInvoice({
    document_kind: 'CREDIT_NOTE',
    credit_title: isFullCredit ? 'Stornorechnung' : 'Rechnungskorrektur',
    original_document: {
      id: 'invoice-1',
      number: 'RE-2026-0007',
      date: '2026-10-05',
      reason: 'Falsche Menge verrechnet',
      snapshot_version: 2,
    },
    ...localeFields(locale),
  });
}

describe('AUT-727 invoice PDF renders in the customer language', () => {
  it('renders an English invoice on the localized layout with English labels', () => {
    const { html, text, footerText } = renderCommittedInvoice(
      committedInvoice(localeFields('en')),
      'RE-2026-0007',
    );

    expect(html).toContain('<html lang="en">');
    expect(text).toContain(pdfLocaleString(enPdf, 'invoice.title'));
    expect(text).toContain(pdfLocaleString(enPdf, 'invoice.recipientLabel'));
    expect(text).toContain(pdfLocaleString(enPdf, 'invoice.descriptionHeader'));
    expect(text).toContain(pdfLocaleString(enPdf, 'invoice.taxBreakdownTitle'));
    expect(text).toContain(pdfLocaleString(enPdf, 'legal.authoritativeGermanNotice'));
    expect(text).not.toContain('Rechnungsempfänger');
    expect(text).not.toContain('Umsatzsteuer-Aufschlüsselung');
    // Localized footer title and the AUT-716 page counter.
    expect(footerText).toContain(pdfLocaleString(enPdf, 'invoice.title'));
    expect(footerText).toContain('Page');
    expect(footerText).not.toContain('Rechnung');
  });

  it('keeps Austrian number format on the English invoice (AUT-719)', () => {
    const { text } = renderCommittedInvoice(
      committedInvoice(localeFields('en')),
      'RE-2026-0007',
    );

    expect(text).toContain('Inspektion 1,5 € 120,00 € 180,00');
    expect(text).toContain('Reifensatz 1 € 1.234,56 € 1.234,56');
    expect(text).toContain('Net: € 1.414,56');
    expect(text).toContain('VAT: € 282,91');
    expect(text).toContain('Gross: € 1.697,47');
    expect(text).not.toContain('1.500');
  });

  it('renders a German invoice on the localized layout with German labels', () => {
    const { html, text, footerText } = renderCommittedInvoice(
      committedInvoice(localeFields('de')),
      'RE-2026-0007',
    );

    expect(html).toContain('<html lang="de">');
    expect(text).toContain(pdfLocaleString(dePdf, 'invoice.title'));
    expect(text).toContain(pdfLocaleString(dePdf, 'invoice.recipientLabel'));
    expect(text).toContain(pdfLocaleString(dePdf, 'invoice.taxBreakdownTitle'));
    // The authoritative-German notice is only printed on non-German documents.
    expect(text).not.toContain(
      pdfLocaleString(dePdf, 'legal.authoritativeGermanNotice'),
    );
    // Localized footer title and the AUT-716 German page counter.
    expect(footerText).toContain(pdfLocaleString(dePdf, 'invoice.title'));
    expect(footerText).toContain('Seite');
    expect(footerText).not.toContain('Page');
  });

  it('keeps Austrian number format on the German invoice (AUT-719)', () => {
    const { text } = renderCommittedInvoice(
      committedInvoice(localeFields('de')),
      'RE-2026-0007',
    );

    expect(text).toContain('Inspektion 1,5 € 120,00 € 180,00');
    expect(text).toContain('Netto: € 1.414,56');
    expect(text).toContain('Umsatzsteuer: € 282,91');
    expect(text).toContain('Brutto: € 1.697,47');
    expect(text).toContain('20 % USt (Netto € 1.414,56): € 282,91');
    expect(text).not.toContain('1.500');
  });

  it('renders a snapshot frozen before localisation on the unchanged legacy layout', () => {
    const { html, text, renderable } = renderCommittedInvoice(
      committedInvoice(),
      'RE-2026-0007',
    );

    expect(renderable?.document_locale).toBeUndefined();
    expect(resolveInvoicePdfLayoutContext(renderable!)).toBeNull();
    expect(html).not.toContain('<html lang=');
    expect(text).toContain('Rechnung');
    expect(text).toContain('Rechnungsempfänger');
  });
});

describe('AUT-728 credit-note footer label matches the heading', () => {
  it.each([
    ['full', true],
    ['partial', false],
  ] as const)('renders an English %s credit note as "Credit note"', (_label, isFull) => {
    const { text, footerText } = renderCommittedCreditNote(
      committedCreditNote('en', isFull),
      'CN-2026-0002',
    );

    expect(text).toContain(pdfLocaleString(enPdf, 'invoice.creditTitle'));
    expect(footerText).toContain(pdfLocaleString(enPdf, 'invoice.creditTitle'));
    expect(footerText).not.toContain('Stornorechnung');
    expect(footerText).not.toContain('Rechnungskorrektur');
  });

  it.each([
    ['full', true],
    ['partial', false],
  ] as const)('renders a German %s credit note footer as the heading term', (_label, isFull) => {
    const { text, footerText } = renderCommittedCreditNote(
      committedCreditNote('de', isFull),
      'CN-2026-0002',
    );

    expect(text).toContain(pdfLocaleString(dePdf, 'invoice.creditTitle'));
    expect(footerText).toContain(pdfLocaleString(dePdf, 'invoice.creditTitle'));
    // The frozen full-credit title must not leak into the localized footer.
    expect(footerText).not.toContain('Stornorechnung');
  });
});
