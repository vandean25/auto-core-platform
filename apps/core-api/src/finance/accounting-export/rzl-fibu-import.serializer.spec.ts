import { DEFAULT_RZL_FORMAT_VERSION } from '../accounting-profile/accounting-profile.codes.js';
import type {
  AccountingExportBookingRow,
  AccountingExportProfileSnapshot,
} from './accounting-export.types.js';
import {
  buildRzlAccountingExportFilename,
  formatRzlAmount,
  formatRzlDate,
  formatRzlTimestampUtc,
  resolveRzlSteuercode,
  serializeRzlFibuImport,
} from './rzl-fibu-import.serializer.js';

const baseSerializerParams = {
  rzl: {
    firmNumber: 'FN-4711',
    costCenterLength: null,
    steuercodes: { vat20: '20', vat13: '13', vat10: '10' },
  },
};

function profile(
  overrides: Partial<AccountingExportProfileSnapshot> = {},
): AccountingExportProfileSnapshot {
  return {
    version: 3,
    profileCode: 'ACP-RZL-AT-EUR-1',
    formatVersion: DEFAULT_RZL_FORMAT_VERSION,
    chart: 'UGB',
    accountLength: 4,
    advisorNumber: null,
    clientNumber: null,
    fiscalYearStartMonth: 1,
    defaultDebtorAccount: '2000',
    serializerParams: baseSerializerParams,
    isEnabled: true,
    ...overrides,
  };
}

function row(
  overrides: Partial<AccountingExportBookingRow> = {},
): AccountingExportBookingRow {
  return {
    documentId: 'invoice-1',
    documentKind: 'INVOICE',
    documentNumber: 'RE-2026-0001',
    documentDate: '2026-01-10',
    lineId: 'line-1',
    polarity: 'S',
    net: '100.00',
    tax: '20.00',
    taxRate: '20.00',
    gross: '120.00',
    debtorAccount: '2000',
    revenueAccount: '8400',
    buKey: null,
    bookingText: 'RE RE-2026-0001',
    ...overrides,
  };
}

function serialize(
  rows: AccountingExportBookingRow[],
  profileOverrides: Partial<AccountingExportProfileSnapshot> = {},
) {
  return serializeRzlFibuImport({
    profile: profile(profileOverrides),
    dateFrom: '2026-01-01',
    dateTo: '2026-01-31',
    createdAt: new Date('2026-01-15T10:04:04.000Z'),
    rows,
  });
}

describe('rzl-fibu-import serializer', () => {
  it('formats amounts with a decimal comma and two places', () => {
    expect(formatRzlAmount('120.00')).toBe('120,00');
    expect(formatRzlAmount('0.5')).toBe('0,50');
    expect(formatRzlAmount('7')).toBe('7,00');
  });

  it('rejects negative, over-precise and malformed amounts', () => {
    expect(() => formatRzlAmount('-1.00')).toThrow('Invalid RZL amount');
    expect(() => formatRzlAmount('1.234')).toThrow('Invalid RZL amount');
    expect(() => formatRzlAmount('1,00')).toThrow('Invalid RZL amount');
  });

  it('formats dates as DD.MM.YYYY and rejects other shapes', () => {
    expect(formatRzlDate('2026-01-10')).toBe('10.01.2026');
    expect(() => formatRzlDate('10.01.2026')).toThrow('Invalid ISO date');
  });

  it('formats the creation timestamp as UTC YYYYMMDDHHMMSS', () => {
    expect(
      formatRzlTimestampUtc(new Date('2026-01-15T10:04:04.999Z')),
    ).toBe('20260115100404');
  });

  it('resolves Steuercodes only for the standard rates', () => {
    const steuercodes = { vat20: '20', vat13: '13', vat10: '10' };
    expect(resolveRzlSteuercode('20', steuercodes)).toBe('20');
    expect(resolveRzlSteuercode('13.00', steuercodes)).toBe('13');
    expect(() => resolveRzlSteuercode('19.00', steuercodes)).toThrow(
      'No RZL Steuercode is configured for VAT rate 19.00',
    );
    expect(() => resolveRzlSteuercode('0.00', steuercodes)).toThrow(
      'No RZL Steuercode is configured',
    );
  });

  it('writes CRLF-terminated Windows-1252 bytes without a BOM', () => {
    const result = serialize([row()]);

    expect(result.bytes.subarray(0, 2).toString('latin1')).toBe('K;');
    expect(result.bytes.subarray(-2).toString('latin1')).toBe('\r\n');
    expect(result.byteLength).toBe(result.bytes.length);
    expect(result.csvText.split('\r\n')).toHaveLength(4);
  });

  it('encodes umlauts as Windows-1252 single bytes', () => {
    const result = serialize([row({ bookingText: 'Rückgabe Ö' })]);
    const bookingLine = result.bytes
      .toString('latin1')
      .split('\r\n')
      .find((line) => line.startsWith('B;'));

    expect(bookingLine).toContain('"Rückgabe Ö"');
    expect(bookingLine).toContain(Buffer.from('ü', 'latin1').toString('latin1'));
  });

  it('is deterministic for identical frozen inputs', () => {
    expect(serialize([row()]).sha256).toBe(serialize([row()]).sha256);
  });

  it('rejects characters outside Windows-1252 instead of replacing them', () => {
    expect(() => serialize([row({ bookingText: 'Test 😀' })])).toThrow(
      'not encodable in Windows-1252',
    );
  });

  it('rejects separators, quotes and formula-leading text', () => {
    expect(() => serialize([row({ bookingText: 'A;B' })])).toThrow(
      'unsupported characters',
    );
    expect(() => serialize([row({ bookingText: 'say "hi"' })])).toThrow(
      'unsupported characters',
    );
    expect(() => serialize([row({ bookingText: '=SUM(A1)' })])).toThrow(
      'unsupported characters',
    );
  });

  it('requires the firm number, chart and pinned format version', () => {
    expect(() =>
      serialize([row()], {
        serializerParams: { rzl: { steuercodes: {} } },
      }),
    ).toThrow('RZL firm number is required');
    expect(() => serialize([row()], { chart: null })).toThrow(
      'RZL chart is required',
    );
    expect(() =>
      serialize([row()], { formatVersion: 'RZL-FIBU-IMPORT-PENDING' }),
    ).toThrow('not the pinned layout');
  });

  it('requires polarity to match the document kind', () => {
    expect(() =>
      serialize([row({ documentKind: 'CREDIT_NOTE', polarity: 'S' })]),
    ).toThrow('RZL row polarity S does not match CREDIT_NOTE');
  });

  it('rejects DATEV BU keys on RZL rows', () => {
    expect(() => serialize([row({ buKey: '9' })])).toThrow(
      'must not carry DATEV BU keys',
    );
  });

  it('requires the original invoice number on credit rows', () => {
    expect(() =>
      serialize([
        row({
          documentKind: 'CREDIT_NOTE',
          documentNumber: 'CN-2026-0001',
          polarity: 'H',
          originalInvoiceNumber: undefined,
        }),
      ]),
    ).toThrow('RZL credit rows require the original invoice number');
  });

  it('builds the legacy-free RZL run filename from server identifiers', () => {
    expect(
      buildRzlAccountingExportFilename({
        legalEntityId: 'entity-1',
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
        runId: 'run-1',
      }),
    ).toBe('RZL_entity-1_2026-01-01_2026-01-31_run-1.csv');
  });
});
