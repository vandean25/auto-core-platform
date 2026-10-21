import type { RzlSteuercodes } from '../accounting-profile/accounting-profile.serializer-params.js';
import {
  DATEV_MAX_CSV_BYTES,
  DATEV_MAX_DOCUMENTS_PER_RUN,
} from './datev-format.constants.js';

/**
 * Official RZL FIBU Euro-Version import field order (41 columns), evidenced from
 * RZL "Handbuch Datenimport" Buchungen chapter 2.2.1 (source S1, August 2026).
 * ACP does not emit this shape; see `RZL_BOOKING_COLUMNS` for the draft K/C/B file.
 */
export const RZL_FIBU_EURO_PUBLIC_FIELD_NAMES = [
  'Kontonummer',
  'Gegenkonto',
  'OP-Nummer',
  'Beleg-Datum',
  'Valuta-Datum',
  'Waehrung',
  'Sollbetrag',
  'Habenbetrag',
  'Steuerbetrag',
  'Fremdwaehrung',
  'Fremdwaehrung-Sollbetrag',
  'Fremdwaehrung-Habenbetrag',
  'Kostenstelle',
  'Belegkreis',
  'Belegnummer',
  'USt-Land',
  'USt-Schluessel',
  'USt-Code',
  'USt-Sondercode',
  'Buchungsart',
  'Abweichende Zahlungsfrist',
  'Abweichende Skontofrist',
  'Abw. Skontoprozentsatz',
  'Buchungstext',
  'Buchungstext 2. Zeile',
  'UID-Nummer',
  'Dienstleistungsnummer',
  'Dienstleistungsland',
  'Dienstleistungsexport',
  'DMS-Schluessel',
  'Kostentraeger',
  'Fremdbelegnummer',
  'Wert 1',
  'Wert 2',
  'Mahnsperre',
  'Zahlungsreferenz',
  'Belegpfad',
  'Reserviert',
  'OSS-Korrekturzeitraum',
  'OSS-Korrekturart',
  'DMS-GUID',
] as const;

/**
 * ACP draft RZL FIBU import layout (see rzl-fibu-import.serializer.ts and the
 * RZL spec). K/C/B booking columns are ACP's own pinned reading, not the official
 * Euro-Version column list above.
 */
export const RZL_FIELD_SEPARATOR = ';';
export const RZL_LINE_BREAK = '\r\n';

export const RZL_RECORD_HEADER = 'K';
export const RZL_RECORD_COLUMNS = 'C';
export const RZL_RECORD_BOOKING = 'B';

/** Booking record fields in order. The column record repeats these names. */
export const RZL_BOOKING_COLUMNS = [
  'SATZART',
  'BUCHUNGSART',
  'BELEGDATUM',
  'BELEGNUMMER',
  'SOLL_HABEN',
  'BETRAG',
  'KONTO',
  'GEGENKONTO',
  'STEUERCODE',
  'BUCHUNGSTEXT',
  'OP_BELEGNUMMER',
  'OP_MODUS',
  'KOSTENSTELLE',
] as const;

export type RzlBookingColumn = (typeof RZL_BOOKING_COLUMNS)[number];

export const RZL_CURRENCY = 'EUR';

/** Buchungsart per document kind: sales invoice (AR) and sales credit note (AG). */
export const RZL_BUCHUNGSART_BY_DOCUMENT_KIND = {
  INVOICE: 'AR',
  CREDIT_NOTE: 'AG',
} as const;

/**
 * Open-item handling: an invoice opens an open item in the collective debtor
 * account (E = eröffnen); a credit note reduces it, referencing the original
 * invoice (M = mindern).
 */
export const RZL_OP_MODUS_BY_DOCUMENT_KIND = {
  INVOICE: 'E',
  CREDIT_NOTE: 'M',
} as const;

export type RzlSteuercodeKey = keyof RzlSteuercodes;

/**
 * Standard Austrian VAT rates with a configurable RZL Steuercode. Zero-rate and
 * any other rate have no entry and block the export (see
 * accounting-export-allocation-rules.ts).
 */
export const RZL_STEUERCODE_KEY_BY_TAX_RATE: ReadonlyMap<
  string,
  RzlSteuercodeKey
> = new Map([
  ['20.00', 'vat20'],
  ['13.00', 'vat13'],
  ['10.00', 'vat10'],
]);

/** Same bounds as DATEV: 10,000 documents and 20 MiB encoded CSV per run. */
export const RZL_MAX_DOCUMENTS_PER_RUN = DATEV_MAX_DOCUMENTS_PER_RUN;
export const RZL_MAX_CSV_BYTES = DATEV_MAX_CSV_BYTES;
