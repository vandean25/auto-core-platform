import type { ResolvedAccountingAllocation } from '../accounting-profile/accounting-profile.types.js';

export type AccountingExportDocumentKind = 'INVOICE' | 'CREDIT_NOTE';

export type AccountingExportBlockerCode =
  | 'LEGACY_DOCUMENT_UNSUPPORTED'
  | 'UNSUPPORTED_EXPORT_TAX_MODE'
  | 'UNSUPPORTED_EXPORT_COUNTRY'
  | 'ACCOUNTING_MAPPING_INCOMPLETE'
  | 'MISSING_OWNERSHIP_EVIDENCE'
  | 'CANCELLED_DOCUMENT'
  | 'INACTIVE_SITE_BLOCKED';

export type AccountingExportBlocker = {
  code: AccountingExportBlockerCode;
  message: string;
  documentId?: string;
  documentKind?: AccountingExportDocumentKind;
  documentNumber?: string | null;
};

export type AccountingExportLineAllocation = {
  lineId: string;
  gross: string;
  accountingAllocation: ResolvedAccountingAllocation;
};

export type AccountingExportManifestDocument = {
  id: string;
  kind: AccountingExportDocumentKind;
  number: string | null;
  date: string;
  siteId: string;
  snapshotHash: string;
  lineIds: string[];
};

export type AccountingExportBookingRow = {
  documentId: string;
  documentKind: AccountingExportDocumentKind;
  documentNumber: string;
  documentDate: string;
  lineId: string;
  polarity: 'S' | 'H';
  net: string;
  tax: string;
  taxRate: string;
  gross: string;
  debtorAccount: string;
  revenueAccount: string;
  buKey: string | null;
  bookingText: string;
  originalInvoiceNumber?: string;
};

export type AccountingExportProfileSnapshot = {
  version: number;
  profileCode: string | null;
  formatVersion: string | null;
  chart: string | null;
  accountLength: number | null;
  advisorNumber: string | null;
  clientNumber: string | null;
  fiscalYearStartMonth: number | null;
  defaultDebtorAccount: string | null;
  isEnabled: boolean;
};

export type AccountingExportCandidate = {
  id: string;
  kind: AccountingExportDocumentKind;
  number: string | null;
  date: string;
  siteId: string;
  snapshotHash: string;
  rows: AccountingExportBookingRow[];
  blockers: AccountingExportBlocker[];
};

export type AccountingExportTotalsBucket = {
  account: string;
  taxRate: string;
  net: string;
  tax: string;
  gross: string;
};

export type AccountingExportOverlapSummary = {
  id: string;
  dateFrom: string;
  dateTo: string;
  createdAt: string;
  fileSha256: string;
  documentCount: number;
};
