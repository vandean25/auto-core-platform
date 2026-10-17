import { readDocumentSnapshotLocaleFields } from '../common/i18n/document-snapshot-locale.js';
import { createPdfTranslator } from '../common/i18n/pdf-i18n.js';
import type { LocalizedInvoicePdfContext } from './invoice-pdf-localized.layout.js';
import type { InvoiceSnapshot } from './invoice-snapshot.js';

export function resolveInvoicePdfLayoutContext(
  snapshot: InvoiceSnapshot,
): LocalizedInvoicePdfContext | null {
  const frozen = readDocumentSnapshotLocaleFields(snapshot);
  if (!frozen) {
    return null;
  }
  return {
    locale: frozen.document_locale,
    t: createPdfTranslator(frozen.document_locale),
  };
}
