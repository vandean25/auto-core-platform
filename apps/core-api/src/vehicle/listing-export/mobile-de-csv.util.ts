import iconv from 'iconv-lite';
import {
  MOBILE_DE_CSV_ENCODING,
  MOBILE_DE_DESCRIPTION_LINE_BREAK,
} from './mobile-de-format.constants.js';

/** Ensures a CSV cell cannot introduce a physical line break in the export file. */
export function sanitizeMobileDeCsvFieldValue(value: string): string {
  return value.replace(/\r\n|\r|\n/g, MOBILE_DE_DESCRIPTION_LINE_BREAK);
}

export function quoteMobileDeField(value: string): string {
  const sanitized = sanitizeMobileDeCsvFieldValue(value);
  return `"${sanitized.replace(/"/g, '""')}"`;
}

export function joinMobileDeRow(fields: string[]): string {
  return fields.map(quoteMobileDeField).join(';');
}

export function encodeMobileDeCsv(content: string): Buffer {
  return iconv.encode(content, MOBILE_DE_CSV_ENCODING);
}

export function decodeMobileDeCsv(bytes: Buffer): string {
  return iconv.decode(bytes, MOBILE_DE_CSV_ENCODING);
}

export function assertMobileDeEncodable(value: string, field: string): void {
  const encoded = iconv.encode(value, MOBILE_DE_CSV_ENCODING);
  const roundTrip = iconv.decode(encoded, MOBILE_DE_CSV_ENCODING);
  if (roundTrip !== value) {
    throw new Error(
      `Field ${field} is not representable in ${MOBILE_DE_CSV_ENCODING}: ${value}`,
    );
  }
}

/** Map advisor newlines to mobile.de in-field line breaks (CSV row stays one physical line). */
export function normalizeMobileDeMultilineText(value: string): string {
  return sanitizeMobileDeCsvFieldValue(value).trim();
}
