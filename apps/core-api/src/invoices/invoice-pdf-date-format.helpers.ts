import {
  isDachRechnungSnapshot,
  type FormatDate,
} from './invoice-pdf.layout.js';
import type { InvoiceSnapshot } from './invoice-snapshot.js';

/**
 * Formats a PDF date: German dd.mm.yyyy for DACH Rechnung layouts, ISO
 * yyyy-mm-dd otherwise. Values that do not parse as dates are echoed back.
 */
export function formatInvoicePdfDate(
  value: string | Date,
  useGermanLocale: boolean,
): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  if (useGermanLocale) {
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
  return (value) =>
    formatInvoicePdfDate(value, isDachRechnungSnapshot(snapshot));
}
