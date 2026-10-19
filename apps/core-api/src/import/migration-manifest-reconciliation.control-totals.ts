import {
  parseCanonicalMigrationCsv,
  rowToCanonicalRecord,
} from './migration-csv-parse.util.js';
import {
  formatSignedMoneyFromCents,
  moneyStringsEqual,
  tryParseMoneyToCents,
} from './migration-money.util.js';
import {
  addMoneyStringsSafe,
  manifestListsFile,
  pushInvalidMoneyIssue,
  pushNotReconciledWhenUploadMissing,
  sumMoneyStringsSafe,
  type MigrationReconciliationOptions,
} from './migration-manifest-reconciliation.helpers.js';
import { MIGRATION_MANIFEST_ERROR_CODES } from './migration-manifest.errors.js';
import { pushMigrationIssue } from './migration-manifest.validation.util.js';
import type {
  MigrationManifest,
  MigrationValidationIssue,
} from './migration-manifest.types.js';

type DocumentTotalBucket = {
  year_month: string;
  doc_type: 'INVOICE' | 'CREDIT_MEMO';
  row_count: number;
  net: string;
  vat: string;
  gross: string;
};

export function validateMigrationDocumentTotals(
  manifest: MigrationManifest,
  files: Record<string, Buffer>,
  issues: MigrationValidationIssue[],
  options: MigrationReconciliationOptions,
): void {
  const totals = manifest.control_totals.document_totals as
    DocumentTotalBucket[] | undefined;
  const listed = manifestListsFile(manifest, 'legacy_documents.csv');
  const buffer = files['legacy_documents.csv'];

  if (!listed) {
    if (Array.isArray(totals) && totals.length > 0) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
        message:
          'document_totals must be empty when legacy_documents.csv is absent',
        field: 'control_totals.document_totals',
      });
    }
    return;
  }

  if (!buffer) {
    pushNotReconciledWhenUploadMissing(
      issues,
      options,
      listed,
      buffer,
      'control_totals.document_totals',
      'legacy_documents.csv',
    );
    return;
  }

  const parsed = parseCanonicalMigrationCsv(buffer);
  const financialRows: Array<{
    year_month: string;
    doc_type: 'INVOICE' | 'CREDIT_MEMO';
    net: string;
    vat: string;
    gross: string;
  }> = [];
  for (const row of parsed.rows) {
    const record = rowToCanonicalRecord(parsed.headers, row);
    const docType = record.doc_type ?? '';
    if (docType !== 'INVOICE' && docType !== 'CREDIT_MEMO') {
      continue;
    }
    const docDate = record.doc_date ?? '';
    const yearMonth = docDate.length >= 7 ? docDate.slice(0, 7) : '';
    financialRows.push({
      year_month: yearMonth,
      doc_type: docType,
      net: record.net_total ?? '0.00',
      vat: record.vat_total ?? '0.00',
      gross: record.gross_total ?? '0.00',
    });
  }

  if (financialRows.length === 0) {
    if (Array.isArray(totals) && totals.length > 0) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
        message:
          'document_totals must be empty when no INVOICE/CREDIT_MEMO rows exist',
        field: 'control_totals.document_totals',
      });
    }
    return;
  }

  if (!Array.isArray(totals)) {
    pushMigrationIssue(issues, {
      code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
      message: 'document_totals must be an array',
      field: 'control_totals.document_totals',
    });
    return;
  }

  const bucketKey = (bucket: DocumentTotalBucket) =>
    `${bucket.year_month}:${bucket.doc_type}`;
  const recomputed = new Map<
    string,
    { row_count: number; net: string; vat: string; gross: string }
  >();

  for (const row of financialRows) {
    const key = `${row.year_month}:${row.doc_type}`;
    const existing = recomputed.get(key);
    if (!existing) {
      recomputed.set(key, {
        row_count: 1,
        net: row.net,
        vat: row.vat,
        gross: row.gross,
      });
      continue;
    }
    existing.row_count += 1;
    const nextNet = sumMoneyStringsSafe([existing.net, row.net], issues, {
      file: 'legacy_documents.csv',
      field: 'net_total',
    });
    const nextVat = sumMoneyStringsSafe([existing.vat, row.vat], issues, {
      file: 'legacy_documents.csv',
      field: 'vat_total',
    });
    const nextGross = sumMoneyStringsSafe([existing.gross, row.gross], issues, {
      file: 'legacy_documents.csv',
      field: 'gross_total',
    });
    if (nextNet === null || nextVat === null || nextGross === null) {
      return;
    }
    existing.net = nextNet;
    existing.vat = nextVat;
    existing.gross = nextGross;
  }

  for (const row of financialRows) {
    const expectedGross = addMoneyStringsSafe(row.net, row.vat, issues, {
      file: 'legacy_documents.csv',
      field: 'gross_total',
    });
    if (expectedGross === null) {
      return;
    }
    if (!moneyStringsEqual(row.gross, expectedGross)) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
        message: `legacy_documents gross ${row.gross} must equal net + vat (${expectedGross})`,
        file: 'legacy_documents.csv',
        field: 'gross_total',
      });
    }
  }

  const declaredByKey = new Map<string, DocumentTotalBucket>();
  for (const bucket of totals) {
    const expectedGross = addMoneyStringsSafe(bucket.net, bucket.vat, issues, {
      field: 'control_totals.document_totals',
    });
    if (expectedGross === null) {
      return;
    }
    if (!moneyStringsEqual(bucket.gross, expectedGross)) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
        message: `document_totals bucket gross ${bucket.gross} must equal net + vat (${expectedGross})`,
        field: 'control_totals.document_totals',
      });
    }
    const key = bucketKey(bucket);
    if (declaredByKey.has(key)) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
        message: `duplicate document_totals bucket ${key}`,
        field: 'control_totals.document_totals',
      });
    }
    declaredByKey.set(key, bucket);
  }

  for (const [key, bucket] of recomputed) {
    const declared = declaredByKey.get(key);
    if (!declared) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
        message: `document_totals missing bucket ${key}`,
        field: 'control_totals.document_totals',
      });
      continue;
    }
    if (declared.row_count !== bucket.row_count) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
        message: `document_totals ${key} row_count is ${declared.row_count}, expected ${bucket.row_count}`,
        field: 'control_totals.document_totals',
      });
    }
    if (!moneyStringsEqual(declared.net, bucket.net)) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
        message: `document_totals ${key} net is ${declared.net}, expected ${bucket.net}`,
        field: 'control_totals.document_totals',
      });
    }
    if (!moneyStringsEqual(declared.vat, bucket.vat)) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
        message: `document_totals ${key} vat is ${declared.vat}, expected ${bucket.vat}`,
        field: 'control_totals.document_totals',
      });
    }
    if (!moneyStringsEqual(declared.gross, bucket.gross)) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
        message: `document_totals ${key} gross is ${declared.gross}, expected ${bucket.gross}`,
        field: 'control_totals.document_totals',
      });
    }
  }

  for (const key of declaredByKey.keys()) {
    if (!recomputed.has(key)) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
        message: `document_totals has extra bucket ${key}`,
        field: 'control_totals.document_totals',
      });
    }
  }
}

export function validateMigrationOpenItemsTotal(
  manifest: MigrationManifest,
  files: Record<string, Buffer>,
  issues: MigrationValidationIssue[],
  options: MigrationReconciliationOptions,
): void {
  const declared = manifest.control_totals.open_items as string | null;
  const listed = manifestListsFile(manifest, 'open_items.csv');
  const buffer = files['open_items.csv'];

  if (!listed) {
    if (declared !== null && declared !== undefined) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
        message: 'open_items total must be null when open_items.csv is absent',
        field: 'control_totals.open_items',
      });
    }
    return;
  }

  if (!buffer) {
    pushNotReconciledWhenUploadMissing(
      issues,
      options,
      listed,
      buffer,
      'control_totals.open_items',
      'open_items.csv',
    );
    return;
  }

  if (declared === null || declared === undefined) {
    pushMigrationIssue(issues, {
      code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
      message: 'open_items total must be set when open_items.csv is present',
      field: 'control_totals.open_items',
      file: 'open_items.csv',
    });
    return;
  }

  const parsed = parseCanonicalMigrationCsv(buffer);
  const amounts: string[] = [];
  for (const row of parsed.rows) {
    const record = rowToCanonicalRecord(parsed.headers, row);
    const value = record.remaining_amount ?? '';
    if (value.length > 0) {
      amounts.push(value);
    }
  }
  let total = 0n;
  for (const amount of amounts) {
    const cents = tryParseMoneyToCents(amount);
    if (cents === null) {
      pushInvalidMoneyIssue(issues, amount, {
        file: 'open_items.csv',
        field: 'remaining_amount',
      });
      return;
    }
    total += cents;
  }
  const computedStr = formatSignedMoneyFromCents(total);
  if (!moneyStringsEqual(String(declared), computedStr)) {
    pushMigrationIssue(issues, {
      code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
      message: `open_items total is ${declared}, recomputed ${computedStr}`,
      field: 'control_totals.open_items',
      file: 'open_items.csv',
    });
  }
}
