import { createHash } from 'node:crypto';
import iconv from 'iconv-lite';
import { DEFAULT_BMD_FORMAT_VERSION } from '../accounting-profile/bmd-profile.codes.js';
import {
  parseAccountingProfileSerializerParams,
  type BmdSteuercodes,
} from '../accounting-profile/accounting-profile.serializer-params.js';
import { isBmdSafeText } from '../accounting-profile/bmd-text-rules.js';
import type {
  AccountingExportBookingRow,
  AccountingExportProfileSnapshot,
} from './accounting-export.types.js';
import type {
  AccountingExportFilenameInput,
  AccountingExportSerializerInput,
  AccountingExportSerializerResult,
} from './accounting-export-serializer.types.js';
import {
  BMD_BOOKING_TEXT_MAX_LENGTH,
  BMD_ENCODING,
  BMD_FIELD_SEPARATOR,
  BMD_LINE_BREAK,
  BMD_MTF_PUBLIC_FIELD_NAMES,
  BMD_SOLLHABEN_BY_DOCUMENT_KIND,
  BMD_STEUERCODE_KEY_BY_TAX_RATE,
  type BmdMtfPublicFieldName,
} from './bmd-format.constants.js';

export type BmdNtcsImportResult = AccountingExportSerializerResult & {
  csvText: string;
};

/**
 * The formats below are this profile's own pinned assumptions (spec A6 and A7),
 * so they stay apart from the RZL and DATEV copies. A BMD validation outcome
 * must not change the RZL or DATEV files.
 */
const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ACCOUNT_LENGTH_PATTERN = /^[1-8]$/;

/** Text fields are double-quoted; text the file cannot carry is rejected, never escaped or truncated. */
function quoteBmdText(value: string): string {
  if (!isBmdSafeText(value)) {
    throw new Error(
      `BMD field cannot be written to an ASCII import file: ${value}`,
    );
  }
  return `"${value}"`;
}

/** Decimal comma, two places, unsigned: credits keep positive amounts and use H. */
export function formatBmdAmount(amount: string): string {
  if (!MONEY_PATTERN.test(amount)) {
    throw new Error(`Invalid BMD amount: ${amount}`);
  }
  const [whole, fraction = ''] = amount.split('.');
  return `${whole},${fraction.padEnd(2, '0')}`;
}

/** Document dates as DD.MM.YYYY. */
export function formatBmdDate(isoDate: string): string {
  const match = ISO_DATE_PATTERN.exec(isoDate);
  if (!match) {
    throw new Error(`Invalid ISO date for BMD: ${isoDate}`);
  }
  return `${match[3]}.${match[2]}.${match[1]}`;
}

export function resolveBmdSteuercode(
  taxRate: string,
  steuercodes: BmdSteuercodes,
): string {
  const key = BMD_STEUERCODE_KEY_BY_TAX_RATE.get(Number(taxRate).toFixed(2));
  const code = key ? steuercodes[key] : null;
  if (!code) {
    throw new Error(`No BMD Steuercode is configured for VAT rate ${taxRate}`);
  }
  return code;
}

function assertProfileLayout(profile: AccountingExportProfileSnapshot): void {
  if (profile.formatVersion !== DEFAULT_BMD_FORMAT_VERSION) {
    throw new Error('BMD profile format version is not the pinned layout');
  }
  if (!profile.chart) {
    throw new Error('BMD chart is required');
  }
  if (
    profile.accountLength === null ||
    !ACCOUNT_LENGTH_PATTERN.test(String(profile.accountLength))
  ) {
    throw new Error('BMD account length must be between 1 and 8');
  }
}

/**
 * The eleven booking fields in `BMD_MTF_PUBLIC_FIELD_NAMES` order (spec A1 / S3).
 * Booking date equals document date, because the period is closed. Kostenstelle
 * stays empty.
 */
export function buildBmdNtcsBookingFields(
  row: AccountingExportBookingRow,
  steuercodes: BmdSteuercodes,
): string[] {
  const isCredit = row.documentKind === 'CREDIT_NOTE';
  const expectedPolarity = isCredit ? 'H' : 'S';
  if (row.polarity !== expectedPolarity) {
    throw new Error(
      `BMD row polarity ${row.polarity} does not match ${row.documentKind}`,
    );
  }
  if (row.buKey !== null) {
    throw new Error('BMD rows must not carry DATEV BU keys');
  }
  if (row.bookingText.length > BMD_BOOKING_TEXT_MAX_LENGTH) {
    throw new Error(
      `BMD booking text exceeds ${BMD_BOOKING_TEXT_MAX_LENGTH} characters`,
    );
  }
  const opReference = isCredit ? row.originalInvoiceNumber : row.documentNumber;
  if (!opReference) {
    throw new Error('BMD credit rows require the original invoice number');
  }

  const byName: Record<BmdMtfPublicFieldName, string> = {
    Buchungsdatum: formatBmdDate(row.documentDate),
    Belegdatum: formatBmdDate(row.documentDate),
    Belegnummer: quoteBmdText(row.documentNumber),
    Konto: quoteBmdText(row.debtorAccount),
    Gegenkonto: quoteBmdText(row.revenueAccount),
    Betrag: formatBmdAmount(row.gross),
    Sollhabenkennzeichen: BMD_SOLLHABEN_BY_DOCUMENT_KIND[row.documentKind],
    Steuercode: resolveBmdSteuercode(row.taxRate, steuercodes),
    Text: quoteBmdText(row.bookingText),
    Kostenstelle: '',
    'OP-Nummer': quoteBmdText(opReference),
  };

  return BMD_MTF_PUBLIC_FIELD_NAMES.map((name) => byName[name]);
}

/**
 * Pure, deterministic BMD booking-file serialization of frozen run facts. Tax
 * keys come only from the run's frozen profile snapshot; no live lookup happens
 * here. The file has no header and every record ends with CRLF.
 */
export function serializeBmdNtcsImport(
  input: AccountingExportSerializerInput,
): BmdNtcsImportResult {
  assertProfileLayout(input.profile);
  if (input.rows.length === 0) {
    throw new Error('BMD export has no booking rows');
  }

  const steuercodes =
    parseAccountingProfileSerializerParams(input.profile.serializerParams).bmd
      ?.steuercodes ?? {};
  const records = input.rows.map((row) =>
    buildBmdNtcsBookingFields(row, steuercodes).join(BMD_FIELD_SEPARATOR),
  );

  const csvText = `${records.join(BMD_LINE_BREAK)}${BMD_LINE_BREAK}`;
  const bytes = iconv.encode(csvText, BMD_ENCODING);

  return {
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    rowCount: input.rows.length,
    byteLength: bytes.length,
    csvText,
  };
}

export function buildBmdAccountingExportFilename(
  input: AccountingExportFilenameInput,
): string {
  return `BMD_${input.legalEntityId}_${input.dateFrom}_${input.dateTo}_${input.runId}.csv`;
}
