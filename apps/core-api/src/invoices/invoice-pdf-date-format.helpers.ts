import { formatDocumentDate } from '../common/format/document-format.js';
import { readDocumentSnapshotLocaleFields } from '../common/i18n/document-snapshot-locale.js';
import { DEFAULT_FORMAT_LOCALE } from '../common/i18n/display-language.js';
import {
  isDachRechnungSnapshot,
  type FormatDate,
} from './invoice-pdf.layout.js';
import type { InvoiceSnapshot } from './invoice-snapshot.js';

/**
 * Legacy invoices without frozen `document_locale` keep the historical DACH vs ISO
 * date switch. Localized snapshots always use de-AT calendar formatting.
 */
export function formatInvoicePdfDate(
  value: string | Date,
  snapshot: InvoiceSnapshot,
): string {
  const frozen = readDocumentSnapshotLocaleFields(snapshot);
  if (frozen) {
    return formatDocumentDate(
      value,
      frozen.format_locale ?? DEFAULT_FORMAT_LOCALE,
    );
  }

  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  if (isDachRechnungSnapshot(snapshot)) {
    return date.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  return date.toISOString().slice(0, 10);
}

/** Builds the date formatter the invoice HTML layout uses for one snapshot. */
export function createInvoicePdfDateFormatter(
  snapshot: InvoiceSnapshot,
): FormatDate {
  return (value) => formatInvoicePdfDate(value, snapshot);
}
