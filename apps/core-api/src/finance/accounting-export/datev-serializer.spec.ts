import {
  DATEV_ADMIN_HEADER_FIELD_COUNT,
  DATEV_BUCHUNGSSTAPEL_COLUMN_COUNT,
  DATEV_ENCODING,
} from './datev-format.constants.js';
import { decodeDatevCsv } from './datev-csv.util.js';
import { serializeDatevBuchungsstapel } from './datev-serializer.js';

describe('datev-serializer', () => {
  const profile = {
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

  it('serializes pinned Buchungsstapel format with CRLF, semicolons and decimal comma', () => {
    const createdAt = new Date('2026-01-15T10:04:04.000Z');
    const result = serializeDatevBuchungsstapel({
      profile,
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
      createdAt,
      rows: [
        {
          documentId: 'invoice-1',
          documentKind: 'INVOICE',
          documentNumber: 'RE-2026-0001',
          documentDate: '2026-01-10',
          lineId: 'line-1',
          polarity: 'S',
          net: '100.00',
          tax: '19.00',
          taxRate: '19.00',
          gross: '119.00',
          debtorAccount: '1000',
          revenueAccount: '8400',
          buKey: null,
          bookingText: 'RE RE-2026-0001',
        },
        {
          documentId: 'credit-1',
          documentKind: 'CREDIT_NOTE',
          documentNumber: 'CN-2026-0001',
          documentDate: '2026-01-20',
          lineId: 'line-1',
          polarity: 'H',
          net: '100.00',
          tax: '19.00',
          taxRate: '19.00',
          gross: '119.00',
          debtorAccount: '1000',
          revenueAccount: '8400',
          buKey: null,
          bookingText: 'CN CN-2026-0001 / RE RE-2026-0001',
          originalInvoiceNumber: 'RE-2026-0001',
        },
      ],
    });

    expect(result.rowCount).toBe(2);
    expect(result.bytes.toString('hex')).toBeTruthy();
    expect(result.csvText.endsWith('\r\n')).toBe(true);
    expect(result.csvText.replace(/\r\n/g, '').includes('\n')).toBe(false);

    const lines = result.csvText.trimEnd().split('\r\n');
    expect(lines).toHaveLength(4);

    const adminFields = lines[0].split(';');
    expect(adminFields).toHaveLength(DATEV_ADMIN_HEADER_FIELD_COUNT);
    expect(adminFields[0]).toBe('"EXTF"');
    expect(adminFields[4]).toBe('13');

    const columnHeaders = lines[1].split(';');
    expect(columnHeaders).toHaveLength(DATEV_BUCHUNGSSTAPEL_COLUMN_COUNT);
    expect(columnHeaders[0]).toBe('Umsatz (ohne Soll/Haben-Kz)');

    expect(lines[2]).toContain('119,00');
    expect(lines[2]).toContain('"S"');
    expect(lines[2]).toContain('"RE-2026-0001"');
    expect(lines[3]).toContain('"H"');

    const decoded = decodeDatevCsv(result.bytes);
    expect(decoded).toBe(result.csvText);
    expect(DATEV_ENCODING).toBe('win1252');
  });

  const stockRow = (
    overrides: Partial<
      Parameters<typeof serializeDatevBuchungsstapel>[0]['rows'][number]
    >,
  ) => ({
    documentId: 'tx-1',
    documentKind: 'STOCK_ADJUSTMENT' as const,
    documentNumber: 'BV-101',
    documentDate: '2026-01-10',
    lineId: 'tx-1',
    polarity: 'S' as const,
    net: '25.00',
    tax: '0.00',
    taxRate: '0.00',
    gross: '25.00',
    debtorAccount: '',
    revenueAccount: '5800',
    buKey: null,
    bookingText: 'BV BRK-001 INVENTORY_COUNT tx-1',
    ...overrides,
  });

  const stockProfile = {
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

  it('AUT-1049: serializes plus stock correction with mapped account and empty BU-Schlüssel (Scenario 2, Anti-criterion 1)', () => {
    const result = serializeDatevBuchungsstapel({
      profile: stockProfile,
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
      createdAt: new Date('2026-01-15T10:04:04.000Z'),
      rows: [stockRow({})],
    });
    const [plusLine] = result.csvText.trimEnd().split('\r\n').slice(2);
    expect(plusLine.split(';').slice(0, 9)).toEqual([
      '25,00',
      '"S"',
      '',
      '',
      '',
      '',
      '',
      '5800',
      '',
    ]);
  });

  it('AUT-1049: serializes minus stock correction with unmapped account and empty BU-Schlüssel (Scenario 5, Anti-criterion 1)', () => {
    const result = serializeDatevBuchungsstapel({
      profile: stockProfile,
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
      createdAt: new Date('2026-01-15T10:04:04.000Z'),
      rows: [
        stockRow({
          documentId: 'tx-2',
          documentNumber: 'BV-102',
          polarity: 'H',
          net: '12.50',
          gross: '12.50',
          revenueAccount: '',
        }),
      ],
    });
    const [minusLine] = result.csvText.trimEnd().split('\r\n').slice(2);
    expect(minusLine.split(';').slice(0, 9)).toEqual([
      '12,50',
      '"H"',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
  });
});
