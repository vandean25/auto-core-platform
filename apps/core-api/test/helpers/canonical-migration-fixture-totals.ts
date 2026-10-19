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

export function dryRunCanonicalMigrationCustomers(
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

export function dryRunCanonicalMigrationVehicles(
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

type DryRunTotals = {
  rows: number;
  create: number;
  error: number;
  skip: number;
  update: number;
};

export async function runCanonicalMigrationFixtureDryRunTotalsCheck(
  app: INestApplication,
  authHeader: string,
  expected: {
    customers: { totals: DryRunTotals; warningRows: number };
    vehicles: { totals: DryRunTotals; warningRows: number };
  },
): Promise<void> {
  const customers = await dryRunCanonicalMigrationCustomers(app, authHeader).expect(
    201,
  );
  expect(customers.body.totals).toMatchObject(expected.customers.totals);
  expect(
    await countDryRunWarningRows(app, authHeader, customers.body.id),
  ).toBe(expected.customers.warningRows);

  const vehicles = await dryRunCanonicalMigrationVehicles(app, authHeader).expect(
    201,
  );
  expect(vehicles.body.totals).toMatchObject(expected.vehicles.totals);
  expect(
    await countDryRunWarningRows(app, authHeader, vehicles.body.id),
  ).toBe(expected.vehicles.warningRows);
}

export async function countDryRunWarningRows(
  app: INestApplication,
  authHeader: string,
  jobId: string,
): Promise<number> {
  const rows = await request(app.getHttpServer())
    .get(`/imports/${jobId}/rows`)
    .set('Authorization', authHeader)
    .expect(200);
  return rows.body.data.filter(
    (row: { warnings?: unknown[] }) => (row.warnings?.length ?? 0) > 0,
  ).length;
}
