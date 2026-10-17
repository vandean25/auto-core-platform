import iconv from 'iconv-lite';
import { MOBILE_DE_CSV_ENCODING } from './mobile-de-format.constants.js';

export function quoteMobileDeField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
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

export function assertMobileDeEncodable(
  value: string,
  field: string,
): void {
  const encoded = iconv.encode(value, MOBILE_DE_CSV_ENCODING);
  const roundTrip = iconv.decode(encoded, MOBILE_DE_CSV_ENCODING);
  if (roundTrip !== value) {
    throw new Error(
      `Field ${field} is not representable in ${MOBILE_DE_CSV_ENCODING}: ${value}`,
    );
  }
}

/** Collapse CR/LF inside description fields before export (ACP reference rule). */
export function normalizeMobileDeMultilineText(value: string): string {
  return value.replace(/\r\n|\r|\n/g, ' ').replace(/\s+/g, ' ').trim();
}
