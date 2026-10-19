import { ImportEntityType } from '@prisma/client';
import type { MigrationCsvFileName } from './migration-csv-dictionary.js';
import { validateMigrationBundle } from './migration-bundle.validation.js';
import type {
  MigrationBundleInput,
  MigrationManifest,
  MigrationValidationIssue,
} from './migration-manifest.types.js';

export type {
  MigrationBundleInput,
  MigrationManifest,
  MigrationManifestFileEntry,
  MigrationValidationIssue,
} from './migration-manifest.types.js';

export { validateMigrationBundle } from './migration-bundle.validation.js';

export function parseMigrationManifestJson(buffer: Buffer): MigrationManifest {
  const text = buffer.toString('utf8');
  return JSON.parse(text) as MigrationManifest;
}

export function assertMigrationBundleValid(input: MigrationBundleInput): void {
  const issues = validateMigrationBundle(input);
  if (issues.length > 0) {
    const error = new Error(issues[0]?.message ?? 'Migration bundle invalid');
    (error as Error & { issues: MigrationValidationIssue[] }).issues = issues;
    throw error;
  }
}

export function canonicalMigrationEntityForFile(
  fileName: MigrationCsvFileName,
): ImportEntityType | null {
  if (fileName === 'customers.csv') {
    return ImportEntityType.CUSTOMER;
  }
  if (fileName === 'vehicles.csv') {
    return ImportEntityType.VEHICLE;
  }
  if (fileName === 'labor_operations.csv') {
    return ImportEntityType.LABOR_OPERATION;
  }
  return null;
}
