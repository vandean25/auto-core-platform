import type {
  AccountingExportBlockerCode,
  AccountingExportDocumentKind,
} from './accounting-export.types.js';

export const ACCOUNTING_EXPORT_DOCUMENT_KINDS = [
  'INVOICE',
  'CREDIT_NOTE',
] as const satisfies readonly AccountingExportDocumentKind[];

export const ACCOUNTING_EXPORT_BLOCKER_CODES = [
  'LEGACY_DOCUMENT_UNSUPPORTED',
  'UNSUPPORTED_EXPORT_TAX_MODE',
  'UNSUPPORTED_EXPORT_COUNTRY',
  'ACCOUNTING_MAPPING_INCOMPLETE',
  'MISSING_OWNERSHIP_EVIDENCE',
  'CANCELLED_DOCUMENT',
  'INACTIVE_SITE_BLOCKED',
] as const satisfies readonly AccountingExportBlockerCode[];

// Compile-time guard: a code added to the union in accounting-export.types.ts
// must also be listed above, or this record needs a value and the build fails.
export const UNLISTED_BLOCKER_CODES: Record<
  Exclude<
    AccountingExportBlockerCode,
    (typeof ACCOUNTING_EXPORT_BLOCKER_CODES)[number]
  >,
  never
> = {};
