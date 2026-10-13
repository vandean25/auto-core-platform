import {
  DEFAULT_BMD_AT_PROFILE_CODE,
  DEFAULT_BMD_FORMAT_VERSION,
} from '../../accounting-profile/accounting-profile.codes.js';
import type {
  AccountingExportBookingRow,
  AccountingExportProfileSnapshot,
} from '../accounting-export.types.js';

/**
 * Sample run for the committed `bmd-sample-export.csv`. Frozen facts only, as
 * the export reads them. Accounts, tax keys and document numbers are fixture
 * values. The file is NOT validated against BMD NTCS; see ./README.md.
 */
export const BMD_SAMPLE_CREATED_AT = new Date('2026-01-31T18:00:00.000Z');
export const BMD_SAMPLE_DATE_FROM = '2026-01-01';
export const BMD_SAMPLE_DATE_TO = '2026-01-31';

export const bmdSampleProfile: AccountingExportProfileSnapshot = {
  version: 3,
  profileCode: DEFAULT_BMD_AT_PROFILE_CODE,
  formatVersion: DEFAULT_BMD_FORMAT_VERSION,
  chart: 'UGB',
  accountLength: 4,
  advisorNumber: null,
  clientNumber: null,
  fiscalYearStartMonth: 1,
  defaultDebtorAccount: '2000',
  serializerParams: {
    bmd: { steuercodes: { vat20: '5020', vat13: '5013', vat10: '5010' } },
  },
  isEnabled: true,
};

export const bmdSampleRows: AccountingExportBookingRow[] = [
  {
    documentId: 'invoice-0001',
    documentKind: 'INVOICE',
    documentNumber: 'RE-2026-0001',
    documentDate: '2026-01-10',
    lineId: 'inv-0001-line-20',
    polarity: 'S',
    net: '100.00',
    tax: '20.00',
    taxRate: '20.00',
    gross: '120.00',
    debtorAccount: '2000',
    revenueAccount: '8400',
    buKey: null,
    bookingText: 'RE RE-2026-0001',
  },
  {
    documentId: 'invoice-0001',
    documentKind: 'INVOICE',
    documentNumber: 'RE-2026-0001',
    documentDate: '2026-01-10',
    lineId: 'inv-0001-line-13',
    polarity: 'S',
    net: '50.00',
    tax: '6.50',
    taxRate: '13.00',
    gross: '56.50',
    debtorAccount: '2000',
    revenueAccount: '8300',
    buKey: null,
    bookingText: 'RE RE-2026-0001',
  },
  {
    documentId: 'invoice-0001',
    documentKind: 'INVOICE',
    documentNumber: 'RE-2026-0001',
    documentDate: '2026-01-10',
    lineId: 'inv-0001-line-10',
    polarity: 'S',
    net: '30.00',
    tax: '3.00',
    taxRate: '10.00',
    gross: '33.00',
    debtorAccount: '2000',
    revenueAccount: '8200',
    buKey: null,
    bookingText: 'RE RE-2026-0001',
  },
  {
    documentId: 'invoice-0002',
    documentKind: 'INVOICE',
    documentNumber: 'RE-2026-0002',
    documentDate: '2026-01-15',
    lineId: 'inv-0002-line-20',
    polarity: 'S',
    net: '200.00',
    tax: '40.00',
    taxRate: '20.00',
    gross: '240.00',
    debtorAccount: '2000',
    revenueAccount: '8400',
    buKey: null,
    bookingText: 'RE RE-2026-0002',
  },
  {
    documentId: 'credit-0001',
    documentKind: 'CREDIT_NOTE',
    documentNumber: 'CN-2026-0001',
    documentDate: '2026-01-20',
    lineId: 'cn-0001-line-13',
    polarity: 'H',
    net: '20.00',
    tax: '2.60',
    taxRate: '13.00',
    gross: '22.60',
    debtorAccount: '2000',
    revenueAccount: '8300',
    buKey: null,
    bookingText: 'CN CN-2026-0001 / RE RE-2026-0001',
    originalInvoiceNumber: 'RE-2026-0001',
  },
];
