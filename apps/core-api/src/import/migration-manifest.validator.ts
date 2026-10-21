import type { MigrationManifest } from './migration-manifest.types.js';

export type { MigrationManifest } from './migration-manifest.types.js';

export { validateMigrationBundle } from './migration-bundle.validation.js';

export function parseMigrationManifestJson(buffer: Buffer): MigrationManifest {
  const text = buffer.toString('utf8');
  return JSON.parse(text) as MigrationManifest;
}
