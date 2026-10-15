import { DEFAULT_RZL_FORMAT_VERSION } from '../../accounting-profile/accounting-profile.codes.js';
import type {
  AccountingExportBookingRow,
  AccountingExportProfileSnapshot,
} from '../accounting-export.types.js';

/**
 * Format-evidenced pilot run for the ACP K/C/B draft layout. Row facts mirror the
 * mixed 20 / 13 / 10 % invoice and partial 13 % credit in the public RZL handbook
 * examples (source S1, chapter 2.3) but use synthetic pilot-customer document
 * numbers and accounts. Not vendor-validated.
 */
export const RZL_DRAFT_EVIDENCED_CREATED_AT = new Date(
  '2026-02-28T12:00:00.000Z',
);
export const RZL_DRAFT_EVIDENCED_DATE_FROM = '2026-02-01';
export const RZL_DRAFT_EVIDENCED_DATE_TO = '2026-02-28';

export const rzlDraftEvidencedProfile: AccountingExportProfileSnapshot = {
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
      firmNumber: 'FN-PILOT',
      costCenterLength: null,
      steuercodes: { vat20: '20', vat13: '13', vat10: '10' },
    },
  },
  isEnabled: true,
};

/** Mixed 20 / 13 / 10 % invoice plus a partial 13 % credit (pilot customer fixture). */
export const rzlDraftEvidencedRows: AccountingExportBookingRow[] = [
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
