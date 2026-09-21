import { createHash } from 'node:crypto';
import {
  DATEV_ADMIN_HEADER_FIELD_COUNT,
  DATEV_BUCHUNGSSTAPEL_COLUMN_COUNT,
  DATEV_BUCHUNGSSTAPEL_COLUMN_HEADERS,
  DATEV_DATA_CATEGORY,
  DATEV_DATA_COLUMN_INDEX,
  DATEV_ENCODING,
  DATEV_EXTF_VERSION,
  DATEV_FORMAT_NAME,
  DATEV_FORMAT_REVISION,
  DATEV_PRODUCER_ID,
} from './datev-format.constants.js';
import {
  assertDatevEncodable,
  encodeDatevCsv,
  formatDatevDateDdMm,
  formatDatevMoney,
  formatDatevTimestampUtc,
  formatDatevYmd,
  joinDatevRow,
  quoteDatevField,
} from './datev-csv.util.js';
import type {
  AccountingExportBookingRow,
  AccountingExportProfileSnapshot,
} from './accounting-export.types.js';

export type DatevSerializerInput = {
  profile: AccountingExportProfileSnapshot;
  dateFrom: string;
  dateTo: string;
  createdAt: Date;
  rows: AccountingExportBookingRow[];
};

export type DatevSerializerResult = {
  bytes: Buffer;
  sha256: string;
  rowCount: number;
  byteLength: number;
  csvText: string;
};

function emptyAdminHeaderFields(): string[] {
  return Array.from({ length: DATEV_ADMIN_HEADER_FIELD_COUNT }, () => '');
}

function buildAdminHeader(input: DatevSerializerInput): string[] {
  const fields = emptyAdminHeaderFields();
  const fiscalYearStartMonth = input.profile.fiscalYearStartMonth ?? 1;
  const fiscalYearStart = `${input.dateFrom.slice(0, 4)}${String(fiscalYearStartMonth).padStart(2, '0')}01`;

  fields[0] = quoteDatevField('EXTF');
  fields[1] = String(DATEV_EXTF_VERSION);
  fields[2] = String(DATEV_DATA_CATEGORY);
  fields[3] = quoteDatevField(DATEV_FORMAT_NAME);
  fields[4] = String(DATEV_FORMAT_REVISION);
  fields[5] = formatDatevTimestampUtc(input.createdAt);
  fields[7] = quoteDatevField(DATEV_PRODUCER_ID);
  fields[10] = input.profile.advisorNumber ?? '';
  fields[11] = input.profile.clientNumber ?? '';
  fields[12] = fiscalYearStart;
  fields[13] = String(input.profile.accountLength ?? 4);
  fields[14] = formatDatevYmd(input.dateFrom);
  fields[15] = formatDatevYmd(input.dateTo);
  fields[16] = quoteDatevField(
    `ACP Export ${input.dateFrom}_${input.dateTo}`.slice(0, 30),
  );
  fields[18] = '1';
  fields[20] = '0';
  fields[21] = quoteDatevField('EUR');

  return fields;
}

function buildColumnHeaderRow(): string[] {
  return [...DATEV_BUCHUNGSSTAPEL_COLUMN_HEADERS];
}

function buildDataRow(row: AccountingExportBookingRow): string[] {
  const fields = Array.from({ length: DATEV_BUCHUNGSSTAPEL_COLUMN_COUNT }, () => '');

  assertDatevEncodable(row.documentNumber);
  assertDatevEncodable(row.bookingText);
  if (row.buKey) {
    assertDatevEncodable(row.buKey);
  }

  fields[DATEV_DATA_COLUMN_INDEX.UMSATZ] = formatDatevMoney(row.gross);
  fields[DATEV_DATA_COLUMN_INDEX.SOLL_HABEN] = quoteDatevField(row.polarity);
  fields[DATEV_DATA_COLUMN_INDEX.KONTO] = row.debtorAccount;
  fields[DATEV_DATA_COLUMN_INDEX.GEGENKONTO] = row.revenueAccount;
  fields[DATEV_DATA_COLUMN_INDEX.BU_SCHLUESSEL] = row.buKey ?? '';
  fields[DATEV_DATA_COLUMN_INDEX.BELEGDATUM] = formatDatevDateDdMm(row.documentDate);
  fields[DATEV_DATA_COLUMN_INDEX.BELEGFELD_1] = quoteDatevField(row.documentNumber);
  fields[DATEV_DATA_COLUMN_INDEX.BELEGFELD_2] = '';
  fields[DATEV_DATA_COLUMN_INDEX.BUCHUNGSTEXT] = quoteDatevField(row.bookingText);

  return fields;
}

export function serializeDatevBuchungsstapel(
  input: DatevSerializerInput,
): DatevSerializerResult {
  const lines = [
    joinDatevRow(buildAdminHeader(input)),
    joinDatevRow(buildColumnHeaderRow()),
    ...input.rows.map((row) => joinDatevRow(buildDataRow(row))),
  ];

  const csvText = `${lines.join('\r\n')}\r\n`;
  const bytes = encodeDatevCsv(csvText);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  return {
    bytes,
    sha256,
    rowCount: input.rows.length,
    byteLength: bytes.length,
    csvText,
  };
}

export function buildAccountingExportFilename(input: {
  legalEntityId: string;
  dateFrom: string;
  dateTo: string;
  runId: string;
}): string {
  return `EXTF_${input.legalEntityId}_${input.dateFrom}_${input.dateTo}_${input.runId}.csv`;
}

export { DATEV_ENCODING };
