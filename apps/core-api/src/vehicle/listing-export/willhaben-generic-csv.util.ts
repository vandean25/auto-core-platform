import { Buffer } from 'node:buffer';
import {
  WILLHABEN_GENERIC_CSV_DELIMITER,
  WILLHABEN_GENERIC_CSV_ENCODING,
} from './willhaben-generic-format.constants.js';

/**
 * C0/C1 control characters (including CR/LF) become a space so a record
 * always stays one physical line.
 */
const CONTROL_CHARACTERS_PATTERN = /[\p{Cc}]/gu;

/** Formula-leading first significant character (spreadsheet CSV injection). */
const FORMULA_PREFIX_PATTERN = /^[\s\p{Cc}]*[=+@-]/u;

/**
 * Sanitises a cell for the spreadsheet-oriented generic willhaben layout:
 * control characters become spaces and formula-leading text (`= + - @`,
 * including leading whitespace/control characters) is prefixed with an
 * apostrophe so spreadsheet applications do not execute it.
 */
export function sanitizeWillhabenCsvFieldValue(value: string): string {
  const normalized = value.replace(CONTROL_CHARACTERS_PATTERN, ' ');
  return FORMULA_PREFIX_PATTERN.test(normalized)
    ? `'${normalized}`
    : normalized;
}

/**
 * RFC 4180 quoting for the generic willhaben layout: every field is quoted
 * and embedded quotes are doubled.
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
