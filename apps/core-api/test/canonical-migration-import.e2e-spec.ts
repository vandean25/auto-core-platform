import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { ApiRootModule } from '../src/api-root.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import {
  cleanupTestTenantGraph,
  createTestAuthToken,
  createTestTenant,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';
import { serializeCsv } from '../src/import/csv-parse.util.js';
import { buildCanonicalMigrationIdentityMapping } from '../src/import/canonical-migration-preset.js';
import { CANONICAL_MIGRATION_PRESET_NAME } from '../src/import/canonical-migration.constants.js';
import { CANONICAL_MIGRATION_FIXTURE_SOURCE_SYSTEM } from '../src/prisma/fixtures/canonical-migration-import-presets.fixture.js';
import { parseMigrationManifestJson } from '../src/import/migration-manifest.validator.js';
import {
  countDryRunWarningRows,
  dryRunCanonicalMigrationCustomers,
  dryRunCanonicalMigrationVehicles,
} from './helpers/canonical-migration-fixture-totals.js';

describe('Canonical migration CSV import (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let tenant: Awaited<ReturnType<typeof createTestTenant>>;
  let authHeader: string;

  const migrationFixtureDir = join(
    process.cwd(),
    'test/fixtures/migration-csv-v1',
  );

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ApiRootModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
    authService = app.get(AuthService);
    tenant = await createTestTenant(prisma, 'canonical-migration-import');
    authHeader = `Bearer ${createTestAuthToken(authService, tenant)}`;
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(prisma, tenant.tenantId);
    await teardownTestApp(app, prisma);
  });

  it('dry-runs synthetic customers with the v1 preset', async () => {
    const job = await dryRunCanonicalMigrationCustomers(app, authHeader).expect(
      201,
    );
    expect(job.body.totals).toEqual({
      rows: 8,
      create: 7,
      error: 1,
      skip: 0,
      update: 0,
    });
    expect(await countDryRunWarningRows(app, authHeader, job.body.id)).toBe(0);
  });

  it('dry-runs synthetic vehicles with the v1 preset', async () => {
    const ownerCsv = serializeCsv(
      [
        'external_id',
        'type',
        'company_name',
        'first_name',
        'last_name',
        'email',
        'phone',
        'vat_id',
        'address_street',
        'address_zip',
        'address_city',
        'address_country',
        'salutation',
        'title',
        'title_suffix',
        'letter_salutation',
        'block_level',
        'block_reason',
        'payment_terms_days',
        'payment_terms_text',
        'bill_to_external_id',
        'labor_price_group_code',
        'last_activity_date',
        'has_open_matters',
        'privacy_objection',
        'mail_stop',
        'anonymized',
      ],
      [
        [
          'cust-001',
          'PRIVATE',
          '',
          'Erika',
          'Müller',
          'erika.mueller@example.invalid',
          '',
          '',
          '',
          '',
          '',
          'AT',
          '',
          '',
          '',
          '',
          'NONE',
          '',
          '',
          '',
          '',
          '',
          '2025-06-01',
          'false',
          'false',
          'false',
          'false',
        ],
        [
          'cust-002',
          'COMPANY',
          'Synth Fleet GmbH',
          '',
          '',
          'fleet@example.invalid',
          '',
          '',
          '',
          '',
          '',
          'AT',
          '',
          '',
          '',
          '',
          'NONE',
          '',
          '',
          '',
          '',
          '',
          '2024-01-15',
          'true',
          'false',
          'false',
          'false',
        ],
      ],
      ',',
    );
    const applyJob = await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', authHeader)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', CANONICAL_MIGRATION_FIXTURE_SOURCE_SYSTEM)
      .field(
        'mapping',
        JSON.stringify(buildCanonicalMigrationIdentityMapping('CUSTOMER')),
      )
      .attach('file', Buffer.from(ownerCsv, 'utf8'), 'customers.csv')
      .expect(201);
    await request(app.getHttpServer())
      .post(`/imports/${applyJob.body.id}/apply`)
      .set('Authorization', authHeader)
      .expect(200);

    const manifest = parseMigrationManifestJson(
      readFileSync(join(migrationFixtureDir, 'manifest.json')),
    );
    const vehiclesCsv = readFileSync(join(migrationFixtureDir, 'vehicles.csv'));

    const job = await request(app.getHttpServer())
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
      .attach('file', vehiclesCsv, 'vehicles.csv')
      .expect(201);

    expect(job.body.totals).toMatchObject({
      rows: 6,
      create: 3,
      error: 3,
      skip: 0,
      update: 0,
    });
    expect(await countDryRunWarningRows(app, authHeader, job.body.id)).toBe(1);
  });

  it('lists the Canonical migration CSV v1 preset for the fixture namespace', async () => {
    await request(app.getHttpServer())
      .post('/imports/mapping-profiles')
      .set('Authorization', authHeader)
      .send({
        entity_type: 'CUSTOMER',
        source_system: CANONICAL_MIGRATION_FIXTURE_SOURCE_SYSTEM,
        name: CANONICAL_MIGRATION_PRESET_NAME,
        mapping: buildCanonicalMigrationIdentityMapping('CUSTOMER'),
      })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get(
        `/imports/mapping-profiles?entityType=CUSTOMER&sourceSystem=${encodeURIComponent(CANONICAL_MIGRATION_FIXTURE_SOURCE_SYSTEM)}`,
      )
      .set('Authorization', authHeader)
      .expect(200);

    expect(
      list.body.data.some(
        (profile: { name: string }) =>
          profile.name === CANONICAL_MIGRATION_PRESET_NAME,
      ),
    ).toBe(true);
  });
});
