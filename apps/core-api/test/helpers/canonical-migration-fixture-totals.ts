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

export async function dryRunCanonicalMigrationCustomers(
  app: INestApplication,
  authHeader: string,
) {
  const manifest = parseMigrationManifestJson(
    readFileSync(join(migrationFixtureDir, 'manifest.json')),
  );
  const customersCsv = readFileSync(join(migrationFixtureDir, 'customers.csv'));
  return request(app.getHttpServer())
    .post('/imports')
    .set('Authorization', authHeader)
    .field('entityType', 'CUSTOMER')
    .field('sourceSystem', CANONICAL_MIGRATION_FIXTURE_SOURCE_SYSTEM)
    .field(
      'mapping',
      JSON.stringify(buildCanonicalMigrationIdentityMapping('CUSTOMER')),
    )
    .field(
      'options',
      JSON.stringify({
        migration_manifest: manifest,
        invalid_vat_as_error: false,
      }),
    )
    .attach('file', customersCsv, 'customers.csv');
}

export async function dryRunCanonicalMigrationVehicles(
  app: INestApplication,
  authHeader: string,
) {
  const manifest = parseMigrationManifestJson(
    readFileSync(join(migrationFixtureDir, 'manifest.json')),
  );
  const vehiclesCsv = readFileSync(join(migrationFixtureDir, 'vehicles.csv'));
  return request(app.getHttpServer())
    .post('/imports')
    .set('Authorization', authHeader)
    .field('entityType', 'VEHICLE')
    .field('sourceSystem', CANONICAL_MIGRATION_FIXTURE_SOURCE_SYSTEM)
    .field(
      'mapping',
      JSON.stringify(buildCanonicalMigrationIdentityMapping('VEHICLE')),
    )
    .field(
      'options',
      JSON.stringify({
        migration_manifest: manifest,
        allow_missing_vin: true,
      }),
    )
    .attach('file', vehiclesCsv, 'vehicles.csv');
}
