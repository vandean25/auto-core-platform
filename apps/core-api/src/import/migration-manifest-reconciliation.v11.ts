import { validateMigrationManifestAssets } from './migration-manifest-reconciliation.assets.js';
import {
  validateMigrationDocumentTotals,
  validateMigrationOpenItemsTotal,
} from './migration-manifest-reconciliation.control-totals.js';
import {
  validateMigrationDomainCounts,
  validateMigrationOpenItemsAsOf,
  validateMigrationOpenOrdersNet,
} from './migration-manifest-reconciliation.v11-domain.js';
import type { MigrationReconciliationOptions } from './migration-manifest-reconciliation.helpers.js';
import type {
  MigrationManifest,
  MigrationValidationIssue,
} from './migration-manifest.types.js';

export type { MigrationReconciliationOptions } from './migration-manifest-reconciliation.helpers.js';

export function validateMigrationManifestReconciliationV11(
  manifest: MigrationManifest,
  files: Record<string, Buffer>,
  assetFiles: Record<string, Buffer>,
  issues: MigrationValidationIssue[],
  options: MigrationReconciliationOptions = { allowPartialFiles: false },
): void {
  validateMigrationDocumentTotals(manifest, files, issues, options);
  validateMigrationOpenItemsTotal(manifest, files, issues, options);

  if (manifest.format_version !== '1.1') {
    return;
  }
  validateMigrationDomainCounts(manifest, files, issues, options);
  validateMigrationOpenOrdersNet(manifest, files, issues, options);
  validateMigrationOpenItemsAsOf(manifest, files, issues, options);
  if (!options.allowPartialFiles) {
    validateMigrationManifestAssets(manifest, files, assetFiles, issues);
  }
}
