import type { BmdSteuercodes } from '../accounting-profile/accounting-profile.serializer-params.js';
import {
  DATEV_MAX_CSV_BYTES,
  DATEV_MAX_DOCUMENTS_PER_RUN,
} from './datev-format.constants.js';

/**
 * ACP draft BMD NTCS booking layout (see bmd-ntcs-import.serializer.ts and the
 * BMD spec source matrix). Public MTF field order is evidenced by source S8 in
 * docs/internal/02-Feature-Specs/Finance/bmd-accounting-export.md; see
 * fixtures/bmd-mtf-public-header.reference.txt.
 */
export const BMD_MTF_PUBLIC_FIELD_NAMES = [
  'Buchungsdatum',
  'Belegdatum',
  'Belegnummer',
  'Konto',
  'Gegenkonto',
  'Betrag',
  'Sollhabenkennzeichen',
  'Steuercode',
  'Text',
  'Kostenstelle',
  'OP-Nummer',
] as const;

export const BMD_ENCODING = 'win1252';
export const BMD_FIELD_SEPARATOR = ';';
export const BMD_LINE_BREAK = '\r\n';

/** Limit for the deterministic booking text built by the candidate rules. */
export const BMD_BOOKING_TEXT_MAX_LENGTH = 60;

/** Sollhabenkennzeichen of the debtor line: S opens the open item (invoice), H reduces it (credit). */
export const BMD_SOLLHABEN_BY_DOCUMENT_KIND = {
  INVOICE: 'S',
  CREDIT_NOTE: 'H',
} as const;

export type BmdSteuercodeKey = keyof BmdSteuercodes;

/**
 * Standard Austrian VAT rates with a configurable BMD Steuercode, as in RZL.
 * Zero-rate and any other rate have no entry and block the export (see
 * accounting-export-allocation-rules.ts).
 */
export const BMD_STEUERCODE_KEY_BY_TAX_RATE: ReadonlyMap<
  string,
  BmdSteuercodeKey
> = new Map([
  ['20.00', 'vat20'],
  ['13.00', 'vat13'],
  ['10.00', 'vat10'],
]);

/** Same bounds as DATEV and RZL: 10,000 documents and 20 MiB encoded per run. */
export const BMD_MAX_DOCUMENTS_PER_RUN = DATEV_MAX_DOCUMENTS_PER_RUN;
export const BMD_MAX_CSV_BYTES = DATEV_MAX_CSV_BYTES;
