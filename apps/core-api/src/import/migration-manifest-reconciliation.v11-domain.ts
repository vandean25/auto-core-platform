import {
  MIGRATION_V11_DOMAIN_COUNT_SPECS,
  type MigrationDomainCountSpec,
} from './migration-domain-counts.config.js';
import {
  parseCanonicalMigrationCsv,
  rowToCanonicalRecord,
} from './migration-csv-parse.util.js';
import { moneyStringsEqual } from './migration-money.util.js';
import {
  manifestListsFile,
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

export function validateMigrationDomainCounts(
  manifest: MigrationManifest,
  files: Record<string, Buffer>,
  issues: MigrationValidationIssue[],
  options: MigrationReconciliationOptions,
): void {
  const domainCounts = manifest.control_totals.domain_counts as
    Record<string, unknown> | undefined;
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
      if (
        typeof declared === 'object' &&
        declared !== null &&
        pushNotReconciledWhenUploadMissing(
          issues,
          options,
          fileListed,
          buffer,
          `control_totals.domain_counts.${spec.domainKey}`,
          spec.fileName,
        )
      ) {
        continue;
      }
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

export function validateMigrationOpenOrdersNet(
  manifest: MigrationManifest,
  files: Record<string, Buffer>,
  issues: MigrationValidationIssue[],
  options: MigrationReconciliationOptions,
): void {
  const declared = manifest.control_totals.open_orders_net as string | null;
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

  if (
    pushNotReconciledWhenUploadMissing(
      issues,
      options,
      listed,
      buffer,
      'control_totals.open_orders_net',
      'open_orders.csv',
    )
  ) {
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
  const computed = sumMoneyStringsSafe(amounts, issues, {
    file: 'open_orders.csv',
    field: 'expected_net_total',
  });
  if (computed === null) {
    return;
  }
  if (!moneyStringsEqual(String(declared), computed)) {
    pushMigrationIssue(issues, {
      code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
      message: `open_orders_net is ${declared}, recomputed ${computed}`,
      field: 'control_totals.open_orders_net',
      file: 'open_orders.csv',
    });
  }
}

export function validateMigrationOpenItemsAsOf(
  manifest: MigrationManifest,
  files: Record<string, Buffer>,
  issues: MigrationValidationIssue[],
  options: MigrationReconciliationOptions,
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

  if (
    pushNotReconciledWhenUploadMissing(
      issues,
      options,
      listed,
      buffer,
      'control_totals.open_items_as_of',
      'open_items.csv',
    )
  ) {
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
