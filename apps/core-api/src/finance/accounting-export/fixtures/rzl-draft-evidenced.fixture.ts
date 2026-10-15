import { DEFAULT_RZL_FORMAT_VERSION } from '../../accounting-profile/accounting-profile.codes.js';
import type {
  AccountingExportBookingRow,
  AccountingExportProfileSnapshot,
} from '../accounting-export.types.js';

/**
 * Format-evidenced rows for the ACP K/C/B draft layout. Amounts, accounts, and
 * document dates follow RZL handbook §2.3 Musterbeispiele (source S1, August
 * 2026): separate single-rate Ausgangsrechnungen and one Gutschrift — not the
 * AUT-350 mixed synthetic sample. The K/C/B file shape is still ACP draft only.
 * Not vendor-validated.
 */
export const RZL_DRAFT_EVIDENCED_CREATED_AT = new Date(
  '2025-02-28T12:00:00.000Z',
);
export const RZL_DRAFT_EVIDENCED_DATE_FROM = '2025-01-01';
export const RZL_DRAFT_EVIDENCED_DATE_TO = '2025-02-28';

export const rzlDraftEvidencedProfile: AccountingExportProfileSnapshot = {
  version: 3,
  profileCode: 'ACP-RZL-AT-EUR-1',
  formatVersion: DEFAULT_RZL_FORMAT_VERSION,
  chart: 'UGB',
  accountLength: 4,
  advisorNumber: null,
  clientNumber: null,
  fiscalYearStartMonth: 1,
  defaultDebtorAccount: '20100',
  serializerParams: {
    rzl: {
      firmNumber: 'FN-PILOT',
      costCenterLength: null,
      steuercodes: { vat20: '20', vat13: '13', vat10: '10' },
    },
  },
  isEnabled: true,
};

/** Handbook example 1 (20 %), 9 (10 %), 10 (13 %), and Gutschrift mit Gegenbuchung (20 %). */
export const rzlDraftEvidencedRows: AccountingExportBookingRow[] = [
  {
    documentId: 'hb-inv-100',
    documentKind: 'INVOICE',
    documentNumber: '100',
    documentDate: '2025-01-15',
    lineId: 'hb-inv-100-line',
    polarity: 'S',
    net: '10000.00',
    tax: '2000.00',
    taxRate: '20.00',
    gross: '12000.00',
    debtorAccount: '20100',
    revenueAccount: '4120',
    buKey: null,
    bookingText: 'RE 100',
  },
  {
    documentId: 'hb-inv-102-10',
    documentKind: 'INVOICE',
    documentNumber: '102',
    documentDate: '2025-02-21',
    lineId: 'hb-inv-102-10-line',
    polarity: 'S',
    net: '1000.00',
    tax: '100.00',
    taxRate: '10.00',
    gross: '1100.00',
    debtorAccount: '20101',
    revenueAccount: '4100',
    buKey: null,
    bookingText: 'RE 102',
  },
  {
    documentId: 'hb-inv-102-13',
    documentKind: 'INVOICE',
    documentNumber: '103',
    documentDate: '2025-02-25',
    lineId: 'hb-inv-102-13-line',
    polarity: 'S',
    net: '1000.00',
    tax: '130.00',
    taxRate: '13.00',
    gross: '1130.00',
    debtorAccount: '20101',
    revenueAccount: '4011',
    buKey: null,
    bookingText: 'RE 103',
  },
  {
    documentId: 'hb-cn-101',
    documentKind: 'CREDIT_NOTE',
    documentNumber: '101',
    documentDate: '2025-01-17',
    lineId: 'hb-cn-101-line',
    polarity: 'H',
    net: '1000.00',
    tax: '200.00',
    taxRate: '20.00',
    gross: '1200.00',
    debtorAccount: '20100',
    revenueAccount: '4120',
    buKey: null,
    bookingText: 'CN 101 / RE 101',
    originalInvoiceNumber: '101',
  },
];
