import {
  DEFAULT_BMD_AT_PROFILE_CODE,
  DEFAULT_BMD_FORMAT_VERSION,
} from '../../accounting-profile/bmd-profile.codes.js';
import type {
  AccountingExportBookingRow,
  AccountingExportProfileSnapshot,
} from '../accounting-export.types.js';

/**
 * Format-evidenced pilot run: row facts follow the public BMD NTCS Massentransferformat
 * (MTF) field order and semantics in docs/internal/02-Feature-Specs/Finance/bmd-accounting-export.md
 * (source matrix, S8). Document numbers and accounts are synthetic fixture values for a
 * pilot customer; they are not production defaults and do not claim BMD vendor acceptance.
 */
export const BMD_MTF_EVIDENCED_CREATED_AT = new Date('2026-02-28T12:00:00.000Z');
export const BMD_MTF_EVIDENCED_DATE_FROM = '2026-02-01';
export const BMD_MTF_EVIDENCED_DATE_TO = '2026-02-28';

export const bmdMtfEvidencedProfile: AccountingExportProfileSnapshot = {
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

/** Mixed 20 / 13 / 10 % invoice plus a partial 13 % credit (pilot customer fixture). */
export const bmdMtfEvidencedRows: AccountingExportBookingRow[] = [
  {
    documentId: 'pilot-inv-0001',
    documentKind: 'INVOICE',
    documentNumber: 'RE-PILOT-2026-0001',
    documentDate: '2026-02-10',
    lineId: 'pilot-inv-0001-line-20',
    polarity: 'S',
    net: '100.00',
    tax: '20.00',
    taxRate: '20.00',
    gross: '120.00',
    debtorAccount: '2000',
    revenueAccount: '8400',
    buKey: null,
    bookingText: 'RE RE-PILOT-2026-0001',
  },
  {
    documentId: 'pilot-inv-0001',
    documentKind: 'INVOICE',
    documentNumber: 'RE-PILOT-2026-0001',
    documentDate: '2026-02-10',
    lineId: 'pilot-inv-0001-line-13',
    polarity: 'S',
    net: '50.00',
    tax: '6.50',
    taxRate: '13.00',
    gross: '56.50',
    debtorAccount: '2000',
    revenueAccount: '8300',
    buKey: null,
    bookingText: 'RE RE-PILOT-2026-0001',
  },
  {
    documentId: 'pilot-inv-0001',
    documentKind: 'INVOICE',
    documentNumber: 'RE-PILOT-2026-0001',
    documentDate: '2026-02-10',
    lineId: 'pilot-inv-0001-line-10',
    polarity: 'S',
    net: '30.00',
    tax: '3.00',
    taxRate: '10.00',
    gross: '33.00',
    debtorAccount: '2000',
    revenueAccount: '8200',
    buKey: null,
    bookingText: 'RE RE-PILOT-2026-0001',
  },
  {
    documentId: 'pilot-credit-0001',
    documentKind: 'CREDIT_NOTE',
    documentNumber: 'CN-PILOT-2026-0001',
    documentDate: '2026-02-20',
    lineId: 'pilot-cn-0001-line-13',
    polarity: 'H',
    net: '20.00',
    tax: '2.60',
    taxRate: '13.00',
    gross: '22.60',
    debtorAccount: '2000',
    revenueAccount: '8300',
    buKey: null,
    bookingText: 'CN CN-PILOT-2026-0001 / RE RE-PILOT-2026-0001',
    originalInvoiceNumber: 'RE-PILOT-2026-0001',
  },
];
