import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { buildCanonicalMigrationIdentityMapping } from '../../src/import/canonical-migration-preset.js';
import { CANONICAL_MIGRATION_FIXTURE_SOURCE_SYSTEM } from '../../src/prisma/fixtures/canonical-migration-import-presets.fixture.js';
import { parseMigrationManifestJson } from '../../src/import/migration-manifest.validator.js';

const migrationFixtureDir = join(
  process.cwd(),
  'test/fixtures/migration-csv-v1',
);

function loadMigrationManifest() {
  return parseMigrationManifestJson(
    readFileSync(join(migrationFixtureDir, 'manifest.json')),
  );
}

function postCanonicalMigrationDryRun(
  app: INestApplication,
  authHeader: string,
  entityType: 'CUSTOMER' | 'VEHICLE',
  fileName: 'customers.csv' | 'vehicles.csv',
  options: Record<string, unknown>,
) {
  const csv = readFileSync(join(migrationFixtureDir, fileName));
  return request(app.getHttpServer())
    .post('/imports')
    .set('Authorization', authHeader)
    .field('entityType', entityType)
    .field('sourceSystem', CANONICAL_MIGRATION_FIXTURE_SOURCE_SYSTEM)
    .field(
      'mapping',
      JSON.stringify(buildCanonicalMigrationIdentityMapping(entityType)),
    )
    .field('options', JSON.stringify({ migration_manifest: loadMigrationManifest(), ...options }))
    .attach('file', csv, fileName);
}

export function dryRunCanonicalMigrationCustomers(
  app: INestApplication,
  authHeader: string,
) {
  return postCanonicalMigrationDryRun(app, authHeader, 'CUSTOMER', 'customers.csv', {
    invalid_vat_as_error: false,
  });
}

export function dryRunCanonicalMigrationVehicles(
  app: INestApplication,
  authHeader: string,
) {
  return postCanonicalMigrationDryRun(app, authHeader, 'VEHICLE', 'vehicles.csv', {
    allow_missing_vin: true,
  });
}
