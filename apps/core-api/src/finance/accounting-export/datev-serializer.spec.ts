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
});
