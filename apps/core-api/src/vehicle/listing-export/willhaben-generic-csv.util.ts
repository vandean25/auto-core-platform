import { Buffer } from 'node:buffer';
import {
  WILLHABEN_GENERIC_CSV_DELIMITER,
  WILLHABEN_GENERIC_CSV_ENCODING,
} from './willhaben-generic-format.constants.js';

/**
 * RFC 4180 quoting for the generic willhaben layout: every field is quoted
 * and embedded quotes are doubled. In-field line breaks are kept verbatim
 * inside the quoted field (RFC 4180 section 2).
 */
export function quoteWillhabenField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function joinWillhabenRow(fields: string[]): string {
  return fields.map(quoteWillhabenField).join(WILLHABEN_GENERIC_CSV_DELIMITER);
}

export function encodeWillhabenCsv(content: string): Buffer {
  return Buffer.from(content, WILLHABEN_GENERIC_CSV_ENCODING);
}

export function decodeWillhabenCsv(bytes: Buffer): string {
  return bytes.toString(WILLHABEN_GENERIC_CSV_ENCODING);
}
