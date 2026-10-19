import { sha256Buffer } from './migration-csv-parse.util.js';
import { MIGRATION_MANIFEST_ERROR_CODES } from './migration-manifest.errors.js';
import { pushMigrationIssue } from './migration-manifest.validation.util.js';
import type {
  MigrationManifest,
  MigrationValidationIssue,
} from './migration-manifest.types.js';

type ManifestAsset = {
  name: string;
  sha256: string;
  size_bytes: number;
  media_type: string;
  created_via: string;
};

export function validateMigrationManifestAssets(
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

  const expectedBundleMembers = new Set<string>([...csvNames, ...assetNames]);
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
