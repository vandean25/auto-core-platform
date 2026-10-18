import { createPdfTranslator } from '../common/i18n/pdf-i18n.js';
import { resolveLocalizedDocumentLocale } from '../common/i18n/pdf-resource-bundle.js';
import type { LocalizedInvoicePdfContext } from './invoice-pdf-localized.layout.js';
import type { InvoiceSnapshot } from './invoice-snapshot.js';

export function resolveInvoicePdfLayoutContext(
  snapshot: InvoiceSnapshot,
): LocalizedInvoicePdfContext | null {
  const locale = resolveLocalizedDocumentLocale(snapshot);
  if (!locale) {
    return null;
  }
  return {
    locale,
    t: createPdfTranslator(locale),
  };
}
