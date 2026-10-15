import { DEFAULT_RZL_FORMAT_VERSION } from '../../accounting-profile/accounting-profile.codes.js';
import type {
  AccountingExportBookingRow,
  AccountingExportProfileSnapshot,
} from '../accounting-export.types.js';

export const RZL_GOLDEN_CREATED_AT = new Date('2026-01-15T10:04:04.000Z');
export const RZL_GOLDEN_DATE_FROM = '2026-01-01';
export const RZL_GOLDEN_DATE_TO = '2026-01-31';

export const rzlGoldenProfile: AccountingExportProfileSnapshot = {
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

function invoiceLine(
  overrides: Partial<AccountingExportBookingRow> &
    Pick<AccountingExportBookingRow, 'taxRate' | 'gross' | 'lineId'>,
): AccountingExportBookingRow {
  return {
    documentId: 'invoice-1',
    documentKind: 'INVOICE',
    documentNumber: 'RE-2026-0001',
    documentDate: '2026-01-10',
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

function creditLine(
  overrides: Partial<AccountingExportBookingRow> &
    Pick<AccountingExportBookingRow, 'taxRate' | 'gross' | 'lineId'>,
): AccountingExportBookingRow {
  return invoiceLine({
    documentId: 'credit-1',
    documentKind: 'CREDIT_NOTE',
    documentNumber: 'CN-2026-0002',
    documentDate: '2026-01-21',
    polarity: 'H',
    bookingText: 'CN CN-2026-0002 / RE RE-2026-0001',
    originalInvoiceNumber: 'RE-2026-0001',
    ...overrides,
  });
}

export const rzlGoldenRate20Rows: AccountingExportBookingRow[] = [
  invoiceLine({ lineId: 'line-20', taxRate: '20.00', gross: '120.00' }),
  creditLine({ lineId: 'credit-20', taxRate: '20.00', gross: '120.00' }),
];

export const rzlGoldenRate13Rows: AccountingExportBookingRow[] = [
  invoiceLine({
    lineId: 'line-13',
    taxRate: '13.00',
    gross: '113.00',
    revenueAccount: '8400',
  }),
  creditLine({ lineId: 'credit-13', taxRate: '13.00', gross: '113.00' }),
];

export const rzlGoldenRate10Rows: AccountingExportBookingRow[] = [
  invoiceLine({
    lineId: 'line-10',
    taxRate: '10.00',
    gross: '110.00',
    revenueAccount: '8400',
  }),
  creditLine({
    lineId: 'credit-10',
    taxRate: '10.00',
    gross: '110.00',
    revenueAccount: '8400',
  }),
];

export const rzlGoldenMixedRows: AccountingExportBookingRow[] = [
  invoiceLine({ lineId: 'l-20', taxRate: '20.00', gross: '120.00' }),
  invoiceLine({
    lineId: 'l-13',
    taxRate: '13.00',
    gross: '56.50',
    revenueAccount: '8300',
  }),
  invoiceLine({
    lineId: 'l-10',
    taxRate: '10.00',
    gross: '33.00',
    revenueAccount: '8200',
  }),
  creditLine({
    lineId: 'c-13',
    taxRate: '13.00',
    gross: '22.60',
    revenueAccount: '8300',
  }),
];
