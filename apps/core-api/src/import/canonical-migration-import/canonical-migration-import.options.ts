import type { MigrationManifest } from '../migration-manifest.types.js';

export function parseMigrationManifestFromDryRunOptions(
  optionsJson: Record<string, unknown>,
): MigrationManifest | undefined {
  const raw = optionsJson.migration_manifest;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  return raw as MigrationManifest;
}
