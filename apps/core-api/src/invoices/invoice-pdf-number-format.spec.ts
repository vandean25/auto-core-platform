import type { DisplayLanguage } from '@prisma/client';
import { extractVisibleTextFromHtml } from '../common/pdf/pdf-html-text.js';
import { escapeHtml } from '../common/pdf/pdf-layout.js';
import {
  DEFAULT_FORMAT_LOCALE,
  I18N_TRANSLATION_BUNDLE_VERSION,
} from '../common/i18n/display-language.js';
import { createInvoicePdfDateFormatter } from './invoice-pdf-date-format.helpers.js';
import { resolveInvoicePdfLayoutContext } from './invoice-pdf-layout-context.js';
import { buildInvoiceHtmlDocumentForSnapshot } from './invoice-pdf-localized.layout.js';
import { toRenderableInvoiceSnapshot } from './invoice-snapshot-render.adapter.js';
import type { InvoiceSnapshot } from './invoice-snapshot.js';
import { toRenderableCreditNoteSnapshot } from '../credit-notes/credit-note-snapshot-render.adapter.js';

/**
 * A German line of the pilot customer repro: 1,5 h at EUR 120,00 net plus 20 % VAT.
 * The second line is over EUR 1.000 so the thousands separator is visible.
 */
const LINES = [
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
];

const SELLER = {
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
};

const CUSTOMER = {
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
};

function committedSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 2,
    document_kind: 'INVOICE',
    site_id: 'site-1',
    legal_entity_id: 'le-1',
    currency: 'EUR',
    seller: SELLER,
    customer: CUSTOMER,
    vehicle: null,
    date: '2026-10-05',
    due_date: '2026-10-19',
    supply_date_from: '2026-10-05',
    supply_date_to: '2026-10-05',
    payment_terms: { days: 14, text: 'Zahlbar innerhalb von 14 Tagen.' },
    items: LINES,
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

function creditNoteSnapshot(documentLocale?: DisplayLanguage) {
  return toRenderableCreditNoteSnapshot(
    committedSnapshot({
      document_kind: 'CREDIT_NOTE',
      credit_title: 'Rechnungskorrektur',
      original_document: {
        id: 'invoice-1',
        number: 'RE-2026-0007',
        date: '2026-10-05',
        reason: 'Falsche Menge verrechnet',
        snapshot_version: 2,
      },
      ...(documentLocale ? { document_locale: documentLocale } : {}),
    }),
    'CN-2026-0002',
    'credit-1',
  )!;
}

function invoiceSnapshot(documentLocale?: DisplayLanguage): InvoiceSnapshot {
  const renderable = toRenderableInvoiceSnapshot(
    committedSnapshot(),
    'RE-2026-0007',
    'inv-1',
  )!;
  if (!documentLocale) {
    return renderable;
  }
  return {
    ...renderable,
    document_locale: documentLocale,
    format_locale: DEFAULT_FORMAT_LOCALE,
    translation_bundle_version: I18N_TRANSLATION_BUNDLE_VERSION,
    legal_text_version: null,
  };
}

function renderPdfText(snapshot: InvoiceSnapshot, number: string): string {
  return extractVisibleTextFromHtml(
    buildInvoiceHtmlDocumentForSnapshot(
      snapshot,
      number,
      escapeHtml,
      createInvoicePdfDateFormatter(snapshot),
      resolveInvoicePdfLayoutContext(snapshot),
    ),
  );
}

describe('AUT-719 invoice and credit note PDF number format', () => {
  describe('German document', () => {
    it('prints the line table with Austrian decimals and a net line total', () => {
      const text = renderPdfText(invoiceSnapshot('de'), 'RE-2026-0007');

      expect(text).toContain('Inspektion 1,5 € 120,00 € 180,00');
      expect(text).toContain('Reifensatz 1 € 1.234,56 € 1.234,56');
      expect(text).not.toContain('1.500');
      expect(text).not.toContain('120.00');
      expect(text).not.toContain('216.00');
      expect(text).not.toContain('€ 216,00');
    });

    it('prints totals and the VAT breakdown with Austrian separators', () => {
      const text = renderPdfText(invoiceSnapshot('de'), 'RE-2026-0007');

      expect(text).toContain('Netto: € 1.414,56');
      expect(text).toContain('Umsatzsteuer: € 282,91');
      expect(text).toContain('Brutto: € 1.697,47');
      expect(text).toContain('20 % USt (Netto € 1.414,56): € 282,91');
    });

    it('totals the printed line column to the printed net total', () => {
      const text = renderPdfText(invoiceSnapshot('de'), 'RE-2026-0007');

      expect(text).toContain(
        'Inspektion 1,5 € 120,00 € 180,00 Reifensatz 1 € 1.234,56 € 1.234,56',
      );
      expect(text).toContain('Netto: € 1.414,56');
    });

    it('formats the credit note like the invoice', () => {
      const text = renderPdfText(creditNoteSnapshot('de'), 'CN-2026-0002');

      expect(text).toContain('Inspektion 1,5 € 120,00 € 180,00');
      expect(text).toContain('Netto: € 1.414,56');
      expect(text).toContain('Brutto: € 1.697,47');
      expect(text).not.toContain('1.500');
      expect(text).not.toContain('€ 216,00');
    });
  });

  describe('German document rendered on the legacy layout', () => {
    it('keeps Austrian numbers without frozen locale fields', () => {
      const snapshot = invoiceSnapshot();
      expect(snapshot.document_locale).toBeUndefined();

      const text = renderPdfText(snapshot, 'RE-2026-0007');

      expect(text).toContain('Rechnung');
      expect(text).toContain('Inspektion 1,5 € 120,00 € 180,00');
      expect(text).toContain('Netto: € 1.414,56');
      expect(text).not.toContain('1.500');
    });
  });

  describe('English document', () => {
    it('keeps Austrian numbers with English labels on the line table and totals', () => {
      const text = renderPdfText(invoiceSnapshot('en'), 'RE-2026-0007');

      expect(text).toContain('Inspektion 1,5 € 120,00 € 180,00');
      expect(text).toContain('Reifensatz 1 € 1.234,56 € 1.234,56');
      expect(text).toContain('Net: € 1.414,56');
      expect(text).toContain('VAT: € 282,91');
      expect(text).toContain('Gross: € 1.697,47');
      expect(text).not.toContain('1.5 €');
      expect(text).not.toContain('€120.00');
    });

    it('keeps Austrian numbers with English labels on the credit note', () => {
      const text = renderPdfText(creditNoteSnapshot('en'), 'CN-2026-0002');

      expect(text).toContain('Inspektion 1,5 € 120,00 € 180,00');
      expect(text).toContain('Gross: € 1.697,47');
      expect(text).not.toContain('€ 216,00');
    });
  });

  describe('amounts shown in the line table', () => {
    it('feeds the net line amount of the committed snapshot to the invoice table', () => {
      const snapshot = invoiceSnapshot();

      expect(snapshot.items.map((item) => item.line_total)).toEqual([
        '180.00',
        '1234.56',
      ]);
    });

    it('feeds the net line amount of the committed snapshot to the credit note table', () => {
      const snapshot = creditNoteSnapshot('de');

      expect(snapshot.items.map((item) => item.line_total)).toEqual([
        '180.00',
        '1234.56',
      ]);
    });

    it('keeps the totals block on the stored snapshot amounts', () => {
      const snapshot = invoiceSnapshot();

      expect([
        snapshot.total_net,
        snapshot.total_tax,
        snapshot.total_gross,
      ]).toEqual(['1414.56', '282.91', '1697.47']);
    });
  });
});
