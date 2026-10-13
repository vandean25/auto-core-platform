import { createHash } from 'node:crypto';
import type {
  AccountingExportBookingRow,
  AccountingExportProfileSnapshot,
} from './accounting-export.types.js';
import {
  buildBmdAccountingExportFilename,
  formatBmdAmount,
  formatBmdDate,
  resolveBmdSteuercode,
  serializeBmdNtcsImport,
} from './bmd-ntcs-import.serializer.js';
import {
  BMD_SAMPLE_CREATED_AT,
  BMD_SAMPLE_DATE_FROM,
  BMD_SAMPLE_DATE_TO,
  bmdSampleProfile,
  bmdSampleRows,
} from './fixtures/bmd-sample-export.fixture.js';

const steuercodes = { vat20: '5020', vat13: '5013', vat10: '5010' };

// Eleven fields, in the order fixed by the spec.
const FIELD = {
  BUCHUNGSDATUM: 0,
  BELEGDATUM: 1,
  BELEGNUMMER: 2,
  KONTO: 3,
  GEGENKONTO: 4,
  BETRAG: 5,
  SOLLHABENKENNZEICHEN: 6,
  STEUERCODE: 7,
  TEXT: 8,
  KOSTENSTELLE: 9,
  OP_NUMMER: 10,
} as const;

function invoiceRow(
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

function creditRow(
  overrides: Partial<AccountingExportBookingRow> = {},
): AccountingExportBookingRow {
  return invoiceRow({
    documentId: 'credit-1',
    documentKind: 'CREDIT_NOTE',
    documentNumber: 'CN-2026-0001',
    documentDate: '2026-01-20',
    lineId: 'cn-line-1',
    polarity: 'H',
    net: '20.00',
    tax: '2.60',
    taxRate: '13.00',
    gross: '22.60',
    revenueAccount: '8300',
    bookingText: 'CN CN-2026-0001 / RE RE-2026-0001',
    originalInvoiceNumber: 'RE-2026-0001',
    ...overrides,
  });
}

function withProfile(
  overrides: Partial<AccountingExportProfileSnapshot>,
): AccountingExportProfileSnapshot {
  return { ...bmdSampleProfile, ...overrides };
}

function serializerInput(
  rows: AccountingExportBookingRow[],
  profile: AccountingExportProfileSnapshot = bmdSampleProfile,
) {
  return {
    profile,
    dateFrom: BMD_SAMPLE_DATE_FROM,
    dateTo: BMD_SAMPLE_DATE_TO,
    createdAt: BMD_SAMPLE_CREATED_AT,
    rows,
  };
}

function recordsOf(csvText: string): string[][] {
  return csvText
    .slice(0, -2)
    .split('\r\n')
    .map((line) => line.split(';'));
}

describe('bmd-ntcs-import serializer', () => {
  describe('field formats', () => {
    it('writes amounts with a decimal comma, two places and no sign', () => {
      expect(formatBmdAmount('120.00')).toBe('120,00');
      expect(formatBmdAmount('56.5')).toBe('56,50');
      expect(formatBmdAmount('7')).toBe('7,00');
    });

    it('rejects signed or over-precise amounts', () => {
      expect(() => formatBmdAmount('-1.00')).toThrow('Invalid BMD amount');
      expect(() => formatBmdAmount('1.234')).toThrow('Invalid BMD amount');
    });

    it('writes document dates as DD.MM.YYYY', () => {
      expect(formatBmdDate('2026-01-10')).toBe('10.01.2026');
    });

    it('rejects dates that are not ISO yyyy-mm-dd', () => {
      expect(() => formatBmdDate('10.01.2026')).toThrow(
        'Invalid ISO date for BMD',
      );
    });

    it('maps 20, 13 and 10 percent to the configured tax keys', () => {
      expect(resolveBmdSteuercode('20.00', steuercodes)).toBe('5020');
      expect(resolveBmdSteuercode('13.00', steuercodes)).toBe('5013');
      expect(resolveBmdSteuercode('10.00', steuercodes)).toBe('5010');
    });

    it('fails when a rate has no configured tax key', () => {
      expect(() => resolveBmdSteuercode('20.00', { vat13: '5013' })).toThrow(
        'No BMD Steuercode is configured for VAT rate 20.00',
      );
    });

    it.each(['0.00', '17.00'])(
      'refuses VAT rate %s, which has no BMD tax key',
      (taxRate) => {
        expect(() => resolveBmdSteuercode(taxRate, steuercodes)).toThrow(
          `No BMD Steuercode is configured for VAT rate ${taxRate}`,
        );
      },
    );
  });

  describe('file layout', () => {
    it('writes a header-less record with the eleven fields in BMD order', () => {
      const result = serializeBmdNtcsImport(serializerInput([invoiceRow()]));

      expect(result.csvText).toBe(
        '10.01.2026;10.01.2026;"RE-2026-0001";"2000";"8400";120,00;S;5020;"RE RE-2026-0001";;"RE-2026-0001"\r\n',
      );
    });

    it('ends every record with CRLF, including the last, and never uses a bare LF', () => {
      const { csvText } = serializeBmdNtcsImport(
        serializerInput(bmdSampleRows),
      );

      expect(csvText.endsWith('\r\n')).toBe(true);
      expect(csvText.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    });

    it('writes S for invoice lines and H for credit lines, with the debtor as Konto', () => {
      const records = recordsOf(
        serializeBmdNtcsImport(serializerInput([invoiceRow(), creditRow()]))
          .csvText,
      );

      expect(records[0][FIELD.SOLLHABENKENNZEICHEN]).toBe('S');
      expect(records[0][FIELD.KONTO]).toBe('"2000"');
      expect(records[1][FIELD.SOLLHABENKENNZEICHEN]).toBe('H');
      expect(records[1][FIELD.KONTO]).toBe('"2000"');
    });

    it('uses the invoice number as OP-Nummer for invoices and the original invoice for credits', () => {
      const records = recordsOf(
        serializeBmdNtcsImport(serializerInput([invoiceRow(), creditRow()]))
          .csvText,
      );

      expect(records[0][FIELD.OP_NUMMER]).toBe('"RE-2026-0001"');
      expect(records[1][FIELD.OP_NUMMER]).toBe('"RE-2026-0001"');
      expect(records[1][FIELD.BELEGNUMMER]).toBe('"CN-2026-0001"');
    });

    it('leaves Kostenstelle empty', () => {
      const records = recordsOf(
        serializeBmdNtcsImport(serializerInput(bmdSampleRows)).csvText,
      );

      expect(records.every((record) => record.length === 11)).toBe(true);
      expect(records.every((record) => record[FIELD.KOSTENSTELLE] === '')).toBe(
        true,
      );
    });

    it('keeps the row order it is given', () => {
      const records = recordsOf(
        serializeBmdNtcsImport(serializerInput(bmdSampleRows)).csvText,
      );

      expect(records.map((record) => record[FIELD.BELEGNUMMER])).toEqual([
        '"RE-2026-0001"',
        '"RE-2026-0001"',
        '"RE-2026-0001"',
        '"RE-2026-0002"',
        '"CN-2026-0001"',
      ]);
    });

    it('writes ASCII only, so the bytes equal the text under ASCII and Windows-1252', () => {
      const { bytes, csvText } = serializeBmdNtcsImport(
        serializerInput(bmdSampleRows),
      );

      expect(bytes.every((byte) => byte < 0x80)).toBe(true);
      expect(bytes.toString('ascii')).toBe(csvText);
    });

    it('returns the SHA-256 of the exact bytes, the byte length and the row count', () => {
      const result = serializeBmdNtcsImport(serializerInput(bmdSampleRows));

      expect(result.sha256).toBe(
        createHash('sha256').update(result.bytes).digest('hex'),
      );
      expect(result.byteLength).toBe(result.bytes.length);
      expect(result.rowCount).toBe(bmdSampleRows.length);
    });

    it('is deterministic for identical input', () => {
      const first = serializeBmdNtcsImport(serializerInput(bmdSampleRows));
      const second = serializeBmdNtcsImport(serializerInput(bmdSampleRows));

      expect(second.bytes.equals(first.bytes)).toBe(true);
      expect(second.sha256).toBe(first.sha256);
    });
  });

  describe('fail-closed checks', () => {
    it('refuses an empty run', () => {
      expect(() => serializeBmdNtcsImport(serializerInput([]))).toThrow(
        'BMD export has no booking rows',
      );
    });

    it('refuses a profile whose format version is not the pinned BMD layout', () => {
      expect(() =>
        serializeBmdNtcsImport(
          serializerInput(
            [invoiceRow()],
            withProfile({ formatVersion: 'RZL-FIBU-IMPORT-ACP-DRAFT-1' }),
          ),
        ),
      ).toThrow('BMD profile format version is not the pinned layout');
    });

    it('refuses a missing chart', () => {
      expect(() =>
        serializeBmdNtcsImport(
          serializerInput([invoiceRow()], withProfile({ chart: null })),
        ),
      ).toThrow('BMD chart is required');
    });

    it('refuses an account length outside 1 to 8', () => {
      for (const accountLength of [0, 9, null]) {
        expect(() =>
          serializeBmdNtcsImport(
            serializerInput([invoiceRow()], withProfile({ accountLength })),
          ),
        ).toThrow('BMD account length must be between 1 and 8');
      }
    });

    it('refuses text the file cannot carry', () => {
      expect(() =>
        serializeBmdNtcsImport(
          serializerInput([invoiceRow({ debtorAccount: 'Müller' })]),
        ),
      ).toThrow('BMD field cannot be written to an ASCII import file: Müller');
    });

    it('refuses a booking text longer than 60 characters', () => {
      expect(() =>
        serializeBmdNtcsImport(
          serializerInput([invoiceRow({ bookingText: 'X'.repeat(61) })]),
        ),
      ).toThrow('BMD booking text exceeds 60 characters');
    });

    it('refuses a polarity that does not match the document kind', () => {
      expect(() =>
        serializeBmdNtcsImport(serializerInput([creditRow({ polarity: 'S' })])),
      ).toThrow('BMD row polarity S does not match CREDIT_NOTE');
    });

    it('refuses DATEV BU keys', () => {
      expect(() =>
        serializeBmdNtcsImport(serializerInput([invoiceRow({ buKey: '9' })])),
      ).toThrow('BMD rows must not carry DATEV BU keys');
    });

    it('requires the original invoice number on a credit', () => {
      expect(() =>
        serializeBmdNtcsImport(
          serializerInput([creditRow({ originalInvoiceNumber: undefined })]),
        ),
      ).toThrow('BMD credit rows require the original invoice number');
    });

    it('refuses a zero-rate line at serialization, as a second line of defence', () => {
      expect(() =>
        serializeBmdNtcsImport(
          serializerInput([
            invoiceRow({ taxRate: '0.00', tax: '0.00', gross: '100.00' }),
          ]),
        ),
      ).toThrow('No BMD Steuercode is configured for VAT rate 0.00');
    });
  });

  describe('filename', () => {
    it('uses BMD_<legal entity>_<from>_<to>_<run>.csv', () => {
      expect(
        buildBmdAccountingExportFilename({
          legalEntityId: 'le-1',
          dateFrom: '2026-01-01',
          dateTo: '2026-01-31',
          runId: 'run-1',
        }),
      ).toBe('BMD_le-1_2026-01-01_2026-01-31_run-1.csv');
    });
  });
});
