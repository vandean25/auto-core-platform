import {
  MIGRATION_V11_DOMAIN_COUNT_SPECS,
  type MigrationDomainCountSpec,
} from './migration-domain-counts.config.js';
import {
  parseCanonicalMigrationCsv,
  rowToCanonicalRecord,
  sha256Buffer,
} from './migration-csv-parse.util.js';
import {
  addMoneyStrings,
  moneyStringsEqual,
  formatSignedMoneyFromCents,
  parseMoneyToCents,
  sumMoneyStrings,
} from './migration-money.util.js';
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

type ManifestAsset = {
  name: string;
  sha256: string;
  size_bytes: number;
  media_type: string;
  created_via: string;
};

function manifestListsFile(
  manifest: MigrationManifest,
  fileName: string,
): boolean {
  return manifest.files.some((entry) => entry.name === fileName);
}

function countEnumBuckets(
  spec: MigrationDomainCountSpec,
  buffer: Buffer,
): Record<string, number> {
  const parsed = parseCanonicalMigrationCsv(buffer);
  const buckets = Object.fromEntries(
    spec.enumKeys.map((key) => [key, 0]),
  ) as Record<string, number>;
  for (const row of parsed.rows) {
    const record = rowToCanonicalRecord(parsed.headers, row);
    const value = record[spec.enumField] ?? '';
    if (value in buckets) {
      buckets[value] += 1;
    }
  }
  return buckets;
}

function validateDomainCounts(
  manifest: MigrationManifest,
  files: Record<string, Buffer>,
  issues: MigrationValidationIssue[],
): void {
  const domainCounts = manifest.control_totals.domain_counts as
    | Record<string, unknown>
    | undefined;
  if (!domainCounts || typeof domainCounts !== 'object') {
    pushMigrationIssue(issues, {
      code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
      message: 'control_totals.domain_counts is required for format 1.1',
      field: 'control_totals.domain_counts',
    });
    return;
  }

  for (const spec of MIGRATION_V11_DOMAIN_COUNT_SPECS) {
    const declared = domainCounts[spec.domainKey];
    const fileListed = manifestListsFile(manifest, spec.fileName);
    const buffer = files[spec.fileName];
    const filePresent = fileListed && buffer !== undefined;

    if (declared === null || declared === undefined) {
      if (fileListed) {
        pushMigrationIssue(issues, {
          code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
          message: `domain_counts.${spec.domainKey} must be set when ${spec.fileName} is listed`,
          field: `control_totals.domain_counts.${spec.domainKey}`,
          file: spec.fileName,
        });
      }
      continue;
    }

    if (!fileListed) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
        message: `domain_counts.${spec.domainKey} must be null when ${spec.fileName} is absent`,
        field: `control_totals.domain_counts.${spec.domainKey}`,
      });
      continue;
    }

    if (!buffer) {
      continue;
    }

    if (typeof declared !== 'object' || declared === null) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
        message: `domain_counts.${spec.domainKey} must be an object when ${spec.fileName} is present`,
        field: `control_totals.domain_counts.${spec.domainKey}`,
      });
      continue;
    }

    const declaredMap = declared as Record<string, number>;
    for (const key of spec.enumKeys) {
      if (!(key in declaredMap)) {
        pushMigrationIssue(issues, {
          code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
          message: `domain_counts.${spec.domainKey} is missing key "${key}"`,
          field: `control_totals.domain_counts.${spec.domainKey}`,
          file: spec.fileName,
        });
      }
    }
    for (const key of Object.keys(declaredMap)) {
      if (!spec.enumKeys.includes(key)) {
        pushMigrationIssue(issues, {
          code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
          message: `domain_counts.${spec.domainKey} has unexpected key "${key}"`,
          field: `control_totals.domain_counts.${spec.domainKey}`,
        });
      }
    }

    const recomputed = countEnumBuckets(spec, buffer);
    const entry = manifest.files.find((f) => f.name === spec.fileName);
    let sum = 0;
    for (const key of spec.enumKeys) {
      const expected = recomputed[key] ?? 0;
      const got = declaredMap[key];
      if (got !== expected) {
        pushMigrationIssue(issues, {
          code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
          message: `domain_counts.${spec.domainKey}.${key} is ${got}, expected ${expected}`,
          field: `control_totals.domain_counts.${spec.domainKey}`,
          file: spec.fileName,
        });
      }
      sum += expected;
    }
    if (entry && sum !== entry.row_count) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
        message: `domain_counts.${spec.domainKey} sum is ${sum}, expected row_count ${entry.row_count}`,
        field: `control_totals.domain_counts.${spec.domainKey}`,
        file: spec.fileName,
      });
    }
  }
}

function validateOpenOrdersNet(
  manifest: MigrationManifest,
  files: Record<string, Buffer>,
  issues: MigrationValidationIssue[],
): void {
  const declared = manifest.control_totals.open_orders_net;
  const listed = manifestListsFile(manifest, 'open_orders.csv');
  const buffer = files['open_orders.csv'];

  if (declared === null || declared === undefined) {
    if (listed) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
        message: 'open_orders_net must be set when open_orders.csv is listed',
        field: 'control_totals.open_orders_net',
        file: 'open_orders.csv',
      });
    }
    return;
  }

  if (!listed) {
    pushMigrationIssue(issues, {
      code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
      message: 'open_orders_net must be null when open_orders.csv is absent',
      field: 'control_totals.open_orders_net',
    });
    return;
  }

  if (!buffer) {
    return;
  }

  const parsed = parseCanonicalMigrationCsv(buffer);
  const amounts: string[] = [];
  for (const row of parsed.rows) {
    const record = rowToCanonicalRecord(parsed.headers, row);
    const value = record.expected_net_total ?? '';
    if (value.length > 0) {
      amounts.push(value);
    }
  }
  const computed = sumMoneyStrings(amounts);
  if (!moneyStringsEqual(String(declared), computed)) {
    pushMigrationIssue(issues, {
      code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
      message: `open_orders_net is ${declared}, recomputed ${computed}`,
      field: 'control_totals.open_orders_net',
      file: 'open_orders.csv',
    });
  }
}

function validateOpenItemsAsOf(
  manifest: MigrationManifest,
  files: Record<string, Buffer>,
  issues: MigrationValidationIssue[],
): void {
  const declared = manifest.control_totals.open_items_as_of as string | null;
  const listed = manifestListsFile(manifest, 'open_items.csv');
  const buffer = files['open_items.csv'];

  if (declared === null || declared === undefined) {
    if (listed) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
        message: 'open_items_as_of must be set when open_items.csv is listed',
        field: 'control_totals.open_items_as_of',
        file: 'open_items.csv',
      });
    }
    return;
  }

  if (!listed) {
    pushMigrationIssue(issues, {
      code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
      message: 'open_items_as_of must be null when open_items.csv is absent',
      field: 'control_totals.open_items_as_of',
    });
    return;
  }

  if (!buffer) {
    return;
  }

  const parsed = parseCanonicalMigrationCsv(buffer);
  for (let index = 0; index < parsed.rows.length; index += 1) {
    const record = rowToCanonicalRecord(parsed.headers, parsed.rows[index]);
    const balanceAsOf = record.balance_as_of ?? '';
    if (balanceAsOf.length > 0 && balanceAsOf !== declared) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
        message: `balance_as_of ${balanceAsOf} must equal control_totals.open_items_as_of ${declared}`,
        file: 'open_items.csv',
        row: index + 1,
        field: 'balance_as_of',
      });
    }
  }
}

function validateDocumentTotals(
  manifest: MigrationManifest,
  files: Record<string, Buffer>,
  issues: MigrationValidationIssue[],
): void {
  const totals = manifest.control_totals.document_totals as
    | DocumentTotalBucket[]
    | undefined;
  const listed = manifestListsFile(manifest, 'legacy_documents.csv');
  const buffer = files['legacy_documents.csv'];

  if (!listed || !buffer) {
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
      doc_type: docType as 'INVOICE' | 'CREDIT_MEMO',
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
    existing.net = sumMoneyStrings([existing.net, row.net]);
    existing.vat = sumMoneyStrings([existing.vat, row.vat]);
    existing.gross = sumMoneyStrings([existing.gross, row.gross]);
  }

  for (const row of financialRows) {
    const expectedGross = addMoneyStrings(row.net, row.vat);
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
    const expectedGross = addMoneyStrings(bucket.net, bucket.vat);
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

function validateSignedOpenItemsTotal(
  manifest: MigrationManifest,
  files: Record<string, Buffer>,
  issues: MigrationValidationIssue[],
): void {
  const declared = manifest.control_totals.open_items as string | null;
  const listed = manifestListsFile(manifest, 'open_items.csv');
  const buffer = files['open_items.csv'];

  if (!listed || !buffer) {
    if (declared !== null && declared !== undefined) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
        message: 'open_items total must be null when open_items.csv is absent',
        field: 'control_totals.open_items',
      });
    }
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
    total += parseMoneyToCents(amount);
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

function validateManifestAssets(
  manifest: MigrationManifest,
  files: Record<string, Buffer>,
  assetFiles: Record<string, Buffer>,
  issues: MigrationValidationIssue[],
): void {
  const assets = (manifest.assets ?? []) as ManifestAsset[];
  const csvNames = new Set(manifest.files.map((entry) => entry.name));
  const assetNames = new Set(assets.map((asset) => asset.name));

  for (const name of assetNames) {
    if (csvNames.has(name as (typeof manifest.files)[number]['name'])) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_EXTRA_BUNDLE_FILE,
        message: `Asset name collides with CSV file name: ${name}`,
        file: name,
      });
    }
  }

  const expectedBundleMembers = new Set<string>([
    ...csvNames,
    ...assetNames,
  ]);
  const received = new Set([
    ...Object.keys(files).filter((name) => name !== 'manifest.json'),
    ...Object.keys(assetFiles),
  ]);

  for (const name of expectedBundleMembers) {
    if (!received.has(name)) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_MISSING_BUNDLE_FILE,
        message: `Bundle is missing listed member: ${name}`,
        file: name,
      });
    }
  }
  for (const name of received) {
    if (!expectedBundleMembers.has(name)) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_EXTRA_BUNDLE_FILE,
        message: `Bundle contains file not listed in manifest: ${name}`,
        file: name,
      });
    }
  }

  for (const asset of assets) {
    const buffer = assetFiles[asset.name];
    if (!buffer) {
      continue;
    }
    const sha256 = sha256Buffer(buffer);
    if (sha256 !== asset.sha256) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_FILE_HASH_MISMATCH,
        message: `sha256 mismatch for asset ${asset.name}`,
        file: asset.name,
        field: 'sha256',
      });
    }
    if (buffer.length !== asset.size_bytes) {
      pushMigrationIssue(issues, {
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
        message: `size_bytes mismatch for asset ${asset.name}`,
        file: asset.name,
        field: 'size_bytes',
      });
    }
  }
}

export function validateMigrationManifestReconciliationV11(
  manifest: MigrationManifest,
  files: Record<string, Buffer>,
  assetFiles: Record<string, Buffer>,
  issues: MigrationValidationIssue[],
): void {
  if (manifest.format_version !== '1.1') {
    return;
  }
  validateDomainCounts(manifest, files, issues);
  validateOpenOrdersNet(manifest, files, issues);
  validateOpenItemsAsOf(manifest, files, issues);
  validateDocumentTotals(manifest, files, issues);
  validateSignedOpenItemsTotal(manifest, files, issues);
  validateManifestAssets(manifest, files, assetFiles, issues);
}
