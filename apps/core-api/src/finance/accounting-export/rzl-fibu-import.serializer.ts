import { createHash } from 'node:crypto';
import iconv from 'iconv-lite';
import { DEFAULT_RZL_FORMAT_VERSION } from '../accounting-profile/accounting-profile.codes.js';
import {
  parseAccountingProfileSerializerParams,
  type RzlSteuercodes,
} from '../accounting-profile/accounting-profile.serializer-params.js';
import type {
  AccountingExportBookingRow,
  AccountingExportProfileSnapshot,
} from './accounting-export.types.js';
import type {
  AccountingExportSerializerInput,
  AccountingExportSerializerResult,
} from './accounting-export-serializer.types.js';
import {
  RZL_BOOKING_COLUMNS,
  RZL_BUCHUNGSART_BY_DOCUMENT_KIND,
  RZL_CURRENCY,
  RZL_FIELD_SEPARATOR,
  RZL_LINE_BREAK,
  RZL_OP_MODUS_BY_DOCUMENT_KIND,
  RZL_RECORD_BOOKING,
  RZL_RECORD_COLUMNS,
  RZL_RECORD_HEADER,
  RZL_STEUERCODE_KEY_BY_TAX_RATE,
} from './rzl-format.constants.js';

export type RzlFibuImportResult = AccountingExportSerializerResult & {
  csvText: string;
};

const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ACCOUNT_LENGTH_PATTERN = /^[1-8]$/;

function assertWindows1252(value: string): void {
  const roundTrip = iconv.decode(iconv.encode(value, 'win1252'), 'win1252');
  if (roundTrip !== value) {
    throw new Error(`RZL field is not encodable in Windows-1252: ${value}`);
  }
}

/** Text fields are double-quoted; quote and control characters are rejected, never escaped or truncated. */
function quoteRzlText(value: string): string {
  if (/[\r\n;"]/.test(value) || /^[=+\-@]/.test(value)) {
    throw new Error(`RZL field contains unsupported characters: ${value}`);
  }
  assertWindows1252(value);
  return `"${value}"`;
}

/** Decimal comma, two places, unsigned: credits keep positive amounts and use H. */
export function formatRzlAmount(amount: string): string {
  if (!MONEY_PATTERN.test(amount)) {
    throw new Error(`Invalid RZL amount: ${amount}`);
  }
  const [whole, fraction = ''] = amount.split('.');
  return `${whole},${fraction.padEnd(2, '0')}`;
}

export function formatRzlDate(isoDate: string): string {
  const match = ISO_DATE_PATTERN.exec(isoDate);
  if (!match) {
    throw new Error(`Invalid ISO date for RZL: ${isoDate}`);
  }
  return `${match[3]}.${match[2]}.${match[1]}`;
}

/** Creation timestamp in UTC as YYYYMMDDHHMMSS. */
export function formatRzlTimestampUtc(createdAt: Date): string {
  return createdAt
    .toISOString()
    .replace(/\.\d{3}Z$/, '')
    .replace(/[-:T]/g, '');
}

export function resolveRzlSteuercode(
  taxRate: string,
  steuercodes: RzlSteuercodes,
): string {
  const key = RZL_STEUERCODE_KEY_BY_TAX_RATE.get(Number(taxRate).toFixed(2));
  const code = key ? steuercodes[key] : null;
  if (!code) {
    throw new Error(`No RZL Steuercode is configured for VAT rate ${taxRate}`);
  }
  return code;
}

function buildHeaderFields(
  profile: AccountingExportProfileSnapshot,
  dateFrom: string,
  dateTo: string,
  createdAt: Date,
): string[] {
  if (profile.formatVersion !== DEFAULT_RZL_FORMAT_VERSION) {
    throw new Error('RZL profile format version is not the pinned layout');
  }
  const firmNumber = parseAccountingProfileSerializerParams(
    profile.serializerParams,
  ).rzl?.firmNumber?.trim();
  if (!firmNumber) {
    throw new Error('RZL firm number is required');
  }
  if (!profile.chart) {
    throw new Error('RZL chart is required');
  }
  if (
    profile.accountLength === null ||
    !ACCOUNT_LENGTH_PATTERN.test(String(profile.accountLength))
  ) {
    throw new Error('RZL account length must be between 1 and 8');
  }

  return [
    RZL_RECORD_HEADER,
    quoteRzlText(DEFAULT_RZL_FORMAT_VERSION),
    quoteRzlText(firmNumber),
    formatRzlTimestampUtc(createdAt),
    formatRzlDate(dateFrom),
    formatRzlDate(dateTo),
    quoteRzlText(RZL_CURRENCY),
    quoteRzlText(profile.chart),
    String(profile.accountLength),
  ];
}

function buildBookingFields(
  row: AccountingExportBookingRow,
  steuercodes: RzlSteuercodes,
): string[] {
  const isCredit = row.documentKind === 'CREDIT_NOTE';
  const expectedPolarity = isCredit ? 'H' : 'S';
  if (row.polarity !== expectedPolarity) {
    throw new Error(
      `RZL row polarity ${row.polarity} does not match ${row.documentKind}`,
    );
  }
  if (row.buKey !== null) {
    throw new Error('RZL rows must not carry DATEV BU keys');
  }
  const opReference = isCredit ? row.originalInvoiceNumber : row.documentNumber;
  if (!opReference) {
    throw new Error('RZL credit rows require the original invoice number');
  }

  return [
    RZL_RECORD_BOOKING,
    RZL_BUCHUNGSART_BY_DOCUMENT_KIND[row.documentKind],
    formatRzlDate(row.documentDate),
    quoteRzlText(row.documentNumber),
    row.polarity,
    formatRzlAmount(row.gross),
    quoteRzlText(row.debtorAccount),
    quoteRzlText(row.revenueAccount),
    resolveRzlSteuercode(row.taxRate, steuercodes),
    quoteRzlText(row.bookingText),
    quoteRzlText(opReference),
    RZL_OP_MODUS_BY_DOCUMENT_KIND[row.documentKind],
    '',
  ];
}

/**
 * Pure, deterministic RZL FIBU serialization of frozen run facts. Steuercodes
 * come only from the run's frozen profile snapshot; no live lookup happens here.
 */
export function serializeRzlFibuImport(
  input: AccountingExportSerializerInput,
): RzlFibuImportResult {
  const steuercodes = parseAccountingProfileSerializerParams(
    input.profile.serializerParams,
  ).rzl?.steuercodes ?? { vat20: null, vat13: null, vat10: null };

  const lines = [
    buildHeaderFields(
      input.profile,
      input.dateFrom,
      input.dateTo,
      input.createdAt,
    ).join(RZL_FIELD_SEPARATOR),
    [RZL_RECORD_COLUMNS, ...RZL_BOOKING_COLUMNS.slice(1)].join(
      RZL_FIELD_SEPARATOR,
    ),
    ...input.rows.map((row) =>
      buildBookingFields(row, steuercodes).join(RZL_FIELD_SEPARATOR),
    ),
  ];

  const csvText = `${lines.join(RZL_LINE_BREAK)}${RZL_LINE_BREAK}`;
  const bytes = iconv.encode(csvText, 'win1252');
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  return {
    bytes,
    sha256,
    rowCount: input.rows.length,
    byteLength: bytes.length,
    csvText,
  };
}

export function buildRzlAccountingExportFilename(input: {
  legalEntityId: string;
  dateFrom: string;
  dateTo: string;
  runId: string;
}): string {
  return `RZL_${input.legalEntityId}_${input.dateFrom}_${input.dateTo}_${input.runId}.csv`;
}
