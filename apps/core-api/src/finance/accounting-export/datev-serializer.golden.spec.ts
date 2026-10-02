import { computeSignedTotals } from './accounting-export-candidates.js';
import type { AccountingExportBookingRow } from './accounting-export.types.js';
import { serializeDatevBuchungsstapel } from './datev-serializer.js';

const baseProfile = {
  version: 2,
  profileCode: 'ACP-DATEV-DE-EUR-1',
  formatVersion: 'EXTF-700-Buchungsstapel-13',
  chart: 'SKR03',
  accountLength: 4,
  advisorNumber: '12345',
  clientNumber: '1',
  fiscalYearStartMonth: 1,
  defaultDebtorAccount: '1000',
  serializerParams: {},
  isEnabled: true,
};

const createdAt = new Date('2026-01-15T10:04:04.000Z');

function bookingRow(
  overrides: Partial<AccountingExportBookingRow> & {
    taxRate: string;
    net: string;
    tax: string;
    gross: string;
  },
): AccountingExportBookingRow {
  return {
    documentId: 'invoice-1',
    documentKind: 'INVOICE',
    documentNumber: 'RE-2026-0001',
    documentDate: '2026-01-10',
    lineId: 'line-1',
    polarity: 'S',
    debtorAccount: '1000',
    revenueAccount: '8400',
    buKey: null,
    bookingText: 'RE RE-2026-0001',
    ...overrides,
  };
}

describe('datev-serializer golden bytes', () => {
  it('pins the legacy 19% invoice + credit fixture bytes', () => {
    const result = serializeDatevBuchungsstapel({
      profile: baseProfile,
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
      createdAt,
      rows: [
        bookingRow({
          taxRate: '19.00',
          net: '100.00',
          tax: '19.00',
          gross: '119.00',
        }),
        bookingRow({
          documentId: 'credit-1',
          documentKind: 'CREDIT_NOTE',
          documentNumber: 'CN-2026-0001',
          documentDate: '2026-01-20',
          polarity: 'H',
          taxRate: '19.00',
          net: '100.00',
          tax: '19.00',
          gross: '119.00',
          bookingText: 'CN CN-2026-0001 / RE RE-2026-0001',
          originalInvoiceNumber: 'RE-2026-0001',
        }),
      ],
    });

    expect(result.sha256).toBe(
      '0952d5a909ffe94b17583ba7375d07a4e6c765a4e71b4c3da9cf1da192b16635',
    );
  });

  it.each([
    { taxRate: '20.00', net: '100.00', tax: '20.00', gross: '120.00' },
    { taxRate: '13.00', net: '100.00', tax: '13.00', gross: '113.00' },
    { taxRate: '10.00', net: '100.00', tax: '10.00', gross: '110.00' },
  ])(
    'serializes Austrian VAT %s invoices and mirrored credit notes',
    ({ taxRate, net, tax, gross }) => {
      const rows: AccountingExportBookingRow[] = [
        bookingRow({ taxRate, net, tax, gross }),
        bookingRow({
          documentId: 'credit-1',
          documentKind: 'CREDIT_NOTE',
          documentNumber: 'CN-2026-0002',
          documentDate: '2026-01-21',
          polarity: 'H',
          taxRate,
          net,
          tax,
          gross,
          bookingText: 'CN CN-2026-0002 / RE RE-2026-0001',
          originalInvoiceNumber: 'RE-2026-0001',
        }),
      ];

      const result = serializeDatevBuchungsstapel({
        profile: baseProfile,
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
        createdAt,
        rows,
      });

      expect(result.rowCount).toBe(2);
      expect(result.csvText).toContain(gross.replace('.', ','));
      expect(result.csvText).toContain('"S"');
      expect(result.csvText).toContain('"H"');

      const totals = computeSignedTotals(rows);
      expect(totals).toHaveLength(1);
      expect(totals[0]?.taxRate).toBe(taxRate);
      expect(totals[0]?.net).toBe('0.00');
      expect(totals[0]?.tax).toBe('0.00');
      expect(totals[0]?.gross).toBe('0.00');
    },
  );
});
