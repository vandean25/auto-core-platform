import type { Page } from 'playwright';
import { escapeHtml } from '../common/pdf/pdf-layout.js';
import {
  buildBrandedInvoiceHeaderTemplate,
  buildInvoiceFooterTemplate,
} from './invoice-pdf.layout.js';
import { resolveInvoicePdfLayoutContext } from './invoice-pdf-layout-context.js';
import type { InvoiceSnapshot } from './invoice-snapshot.js';
import {
  isCreditNoteSnapshot,
  isDachRechnungSnapshot,
} from './invoice-pdf.layout.js';

export type InvoicePdfOptions = NonNullable<Parameters<Page['pdf']>[0]>;

export interface InvoicePdfOptionsInput {
  snapshot: InvoiceSnapshot;
  invoiceNumber: string;
  branded: boolean;
  logoDataUrl: string | null;
  fontFaceCss: string;
}

/** Branded invoices reserve letterhead space; standard invoices use plain margins. */
export function buildInvoicePdfMargin(
  branded: boolean,
): NonNullable<InvoicePdfOptions['margin']> {
  return branded
    ? { top: '32mm', right: '16mm', bottom: '28mm', left: '16mm' }
    : { top: '50px', right: '50px', bottom: '70px', left: '50px' };
}

function buildInvoicePdfHeaderTemplate({
  snapshot,
  branded,
  logoDataUrl,
  fontFaceCss,
}: InvoicePdfOptionsInput): string {
  return branded
    ? buildBrandedInvoiceHeaderTemplate(
        snapshot,
        logoDataUrl,
        escapeHtml,
        fontFaceCss,
      )
    : '<div></div>';
}

function resolveLocalizedInvoiceFooterTitlePrefix(
  snapshot: InvoiceSnapshot,
): string | null {
  const ctx = resolveInvoicePdfLayoutContext(snapshot);
  if (!ctx) {
    return null;
  }
  const { t } = ctx;
  if (isCreditNoteSnapshot(snapshot)) {
    return t('invoice.creditTitle');
  }
  if (isDachRechnungSnapshot(snapshot)) {
    return t('invoice.title');
  }
  return t('invoice.legacyTitle');
}

/** Assembles the page.pdf() options for one invoice render. */
export function buildInvoicePdfOptions(
  input: InvoicePdfOptionsInput,
): InvoicePdfOptions {
  const footerTitlePrefix = resolveLocalizedInvoiceFooterTitlePrefix(
    input.snapshot,
  );
  return {
    format: 'A4',
    margin: buildInvoicePdfMargin(input.branded),
    displayHeaderFooter: true,
    headerTemplate: buildInvoicePdfHeaderTemplate(input),
    footerTemplate: buildInvoiceFooterTemplate(
      input.invoiceNumber,
      escapeHtml,
      input.snapshot,
      input.fontFaceCss,
      footerTitlePrefix,
    ),
    printBackground: true,
  };
}
