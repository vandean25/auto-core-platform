import { DEFAULT_RZL_FORMAT_VERSION } from '../accounting-profile/accounting-profile.codes.js';
import type {
  AccountingExportBookingRow,
  AccountingExportProfileSnapshot,
} from './accounting-export.types.js';
import { serializeRzlFibuImport } from './rzl-fibu-import.serializer.js';

const rzlProfile: AccountingExportProfileSnapshot = {
  version: 3,
  profileCode: 'ACP-RZL-AT-EUR-1',
  formatVersion: DEFAULT_RZL_FORMAT_VERSION,
  chart: 'UGB',
  accountLength: 4,
  advisorNumber: null,
  clientNumber: null,
  fiscalYearStartMonth: 1,
  defaultDebtorAccount: '2000',
  serializerParams: {
    rzl: {
      firmNumber: 'FN-4711',
      costCenterLength: null,
      steuercodes: { vat20: '20', vat13: '13', vat10: '10' },
    },
  },
  isEnabled: true,
};

const createdAt = new Date('2026-01-15T10:04:04.000Z');

const EXPECTED_HEADER =
  'K;"RZL-FIBU-IMPORT-ACP-DRAFT-1";"FN-4711";20260115100404;01.01.2026;31.01.2026;"EUR";"UGB";4';
const EXPECTED_COLUMNS =
  'C;BUCHUNGSART;BELEGDATUM;BELEGNUMMER;SOLL_HABEN;BETRAG;KONTO;GEGENKONTO;STEUERCODE;BUCHUNGSTEXT;OP_BELEGNUMMER;OP_MODUS;KOSTENSTELLE';

function bookingRow(
  overrides: Partial<AccountingExportBookingRow> &
    Pick<AccountingExportBookingRow, 'taxRate' | 'gross'>,
): AccountingExportBookingRow {
  return {
    documentId: 'invoice-1',
    documentKind: 'INVOICE',
    documentNumber: 'RE-2026-0001',
    documentDate: '2026-01-10',
    lineId: 'line-1',
    polarity: 'S',
    net: '0.00',
    tax: '0.00',
    debtorAccount: '2000',
    revenueAccount: '8400',
    buKey: null,
    bookingText: 'RE RE-2026-0001',
    ...overrides,
  };
}

function creditRow(
  overrides: Partial<AccountingExportBookingRow> &
    Pick<AccountingExportBookingRow, 'taxRate' | 'gross'>,
): AccountingExportBookingRow {
  return bookingRow({
    documentId: 'credit-1',
    documentKind: 'CREDIT_NOTE',
    documentNumber: 'CN-2026-0002',
    documentDate: '2026-01-21',
    lineId: 'credit-line-1',
    polarity: 'H',
    bookingText: 'CN CN-2026-0002 / RE RE-2026-0001',
    originalInvoiceNumber: 'RE-2026-0001',
    ...overrides,
  });
}

function serialize(rows: AccountingExportBookingRow[]) {
  return serializeRzlFibuImport({
    profile: rzlProfile,
    dateFrom: '2026-01-01',
    dateTo: '2026-01-31',
    createdAt,
    rows,
  });
}

describe('rzl-fibu-import golden bytes', () => {
  it.each([
    {
      rate: '20.00',
      code: '20',
      gross: '120.00',
      expectedSha256:
        'd9b7869f7cc10e96b8f87feac209759a10125e400db040b66d4152c17f5988c1',
    },
    {
      rate: '13.00',
      code: '13',
      gross: '113.00',
      expectedSha256:
        'c36b1307f5922f513002d20cad0df401b42f72be8ed81b08cf307924694d0a1f',
    },
    {
      rate: '10.00',
      code: '10',
      gross: '110.00',
      expectedSha256:
        '5817761d186f6cf84f84bd40845e9384760a85c21fc7c5f498873107c6a53a18',
    },
  ])(
    'pins the $rate% invoice and mirrored credit note layout',
    ({ rate, code, gross, expectedSha256 }) => {
      const result = serialize([
        bookingRow({ taxRate: rate, gross }),
        creditRow({ taxRate: rate, gross }),
      ]);

      expect(result.csvText).toBe(
        [
          EXPECTED_HEADER,
          EXPECTED_COLUMNS,
          `B;AR;10.01.2026;"RE-2026-0001";S;${gross.replace('.', ',')};"2000";"8400";${code};"RE RE-2026-0001";"RE-2026-0001";E;`,
          `B;AG;21.01.2026;"CN-2026-0002";H;${gross.replace('.', ',')};"2000";"8400";${code};"CN CN-2026-0002 / RE RE-2026-0001";"RE-2026-0001";M;`,
          '',
        ].join('\r\n'),
      );
      expect(result.rowCount).toBe(2);
      expect(result.sha256).toBe(expectedSha256);
    },
  );

  it('pins a mixed 20/13/10 invoice with a partial 13% credit', () => {
    const result = serialize([
      bookingRow({ lineId: 'l-20', taxRate: '20.00', gross: '120.00' }),
      bookingRow({ lineId: 'l-13', taxRate: '13.00', gross: '56.50' }),
      bookingRow({ lineId: 'l-10', taxRate: '10.00', gross: '33.00' }),
      creditRow({ lineId: 'c-13', taxRate: '13.00', gross: '22.60' }),
    ]);

    expect(result.csvText).toBe(
      [
        EXPECTED_HEADER,
        EXPECTED_COLUMNS,
        'B;AR;10.01.2026;"RE-2026-0001";S;120,00;"2000";"8400";20;"RE RE-2026-0001";"RE-2026-0001";E;',
        'B;AR;10.01.2026;"RE-2026-0001";S;56,50;"2000";"8400";13;"RE RE-2026-0001";"RE-2026-0001";E;',
        'B;AR;10.01.2026;"RE-2026-0001";S;33,00;"2000";"8400";10;"RE RE-2026-0001";"RE-2026-0001";E;',
        'B;AG;21.01.2026;"CN-2026-0002";H;22,60;"2000";"8400";13;"CN CN-2026-0002 / RE RE-2026-0001";"RE-2026-0001";M;',
        '',
      ].join('\r\n'),
    );
    expect(result.sha256).toBe('95dd62d89034e4546fc3db66d761271777f8397300c63d17bdb099a9523a7bdc');
  });
});
