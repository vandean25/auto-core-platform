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
import {
  headerOnlyCanonicalCsvBytes,
  parseCanonicalMigrationCsv,
  sha256Buffer,
} from '../src/import/migration-csv-parse.util.js';
import { MIGRATION_MANIFEST_ERROR_CODES } from '../src/import/migration-manifest.errors.js';
import { buildCanonicalMigrationIdentityMapping } from '../src/import/canonical-migration-preset.js';
import { CANONICAL_MIGRATION_FIXTURE_SOURCE_SYSTEM } from '../src/prisma/fixtures/canonical-migration-import-presets.fixture.js';
import { parseMigrationManifestJson } from '../src/import/migration-manifest.validator.js';

describe('Canonical migration reconciliation (e2e)', () => {
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
    tenant = await createTestTenant(prisma, 'canonical-migration-reconcile');
    authHeader = `Bearer ${createTestAuthToken(authService, tenant)}`;
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(prisma, tenant.tenantId);
    await teardownTestApp(app, prisma);
  });

  it('returns 400 when partial dry-run cannot reconcile stock_value without stock file', async () => {
    const customers = readFileSync(join(migrationFixtureDir, 'customers.csv'));
    const manifest = parseMigrationManifestJson(
      readFileSync(join(migrationFixtureDir, 'manifest.json')),
    );
    manifest.control_totals.stock_value = '100.00';

    await request(app.getHttpServer())
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
      .attach('file', customers, 'customers.csv')
      .expect(400)
      .expect((response) => {
        expect(
          response.body.issues?.some(
            (issue: { code?: string; field?: string }) =>
              issue.code ===
                MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_NOT_RECONCILED &&
              issue.field === 'control_totals.stock_value',
          ),
        ).toBe(true);
      });
  });

  it('returns 400 when partial dry-run cannot reconcile open_orders_net', async () => {
    const customers = readFileSync(join(migrationFixtureDir, 'customers.csv'));
    const openOrdersHeader = headerOnlyCanonicalCsvBytes('open_orders.csv');
    const manifest = parseMigrationManifestJson(
      readFileSync(join(migrationFixtureDir, 'manifest.json')),
    );
    manifest.files.push({
      name: 'open_orders.csv',
      sha256: sha256Buffer(openOrdersHeader),
      row_count: 0,
    });
    manifest.control_totals.open_orders_net = '1.00';
    const countsByType = manifest.control_totals.counts_by_type as Record<
      string,
      number
    >;
    manifest.control_totals.counts_by_type = {
      ...countsByType,
      open_orders: 0,
    };

    await request(app.getHttpServer())
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
      .attach('file', customers, 'customers.csv')
      .expect(400)
      .expect((response) => {
        expect(
          response.body.issues?.some(
            (issue: { code?: string }) =>
              issue.code ===
              MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_NOT_RECONCILED,
          ),
        ).toBe(true);
      });
  });

  it('validate endpoint reports invalid money without HTTP 500', async () => {
    const parsedHeader = parseCanonicalMigrationCsv(
      headerOnlyCanonicalCsvBytes('open_orders.csv'),
    );
    const cells = parsedHeader.headers.map((header) => {
      if (header === 'external_id') return 'ord-1';
      if (header === 'original_order_no') return '1001';
      if (header === 'original_order_date') return '2026-01-01';
      if (header === 'kind') return 'ORDER';
      if (header === 'source_status') return 'OPEN';
      if (header === 'partially_invoiced') return 'false';
      if (header === 'site_code') return 'MAIN';
      if (header === 'customer_external_id') return 'cust-001';
      if (header === 'vehicle_external_id') return 'veh-001';
      if (header === 'currency') return 'EUR';
      if (header === 'expected_net_total') return '1.0';
      if (header === 'order_discount_net') return '0.00';
      return '';
    });
    const openOrdersCsv = Buffer.from(
      `${parsedHeader.headers.join(',')}\r\n${cells.join(',')}\r\n`,
      'utf8',
    );
    const parsed = parseCanonicalMigrationCsv(openOrdersCsv);
    const manifest = {
      format_version: '1.1',
      source_name: 'synthetic_dms',
      source_system: 'synthetic_dms:synth_fixture',
      source_company_code: 'synth_fixture',
      extracted_at: '2026-10-19T08:00:00Z',
      cutover_date: '2026-11-01',
      currency: 'EUR',
      files: [
        {
          name: 'open_orders.csv',
          sha256: parsed.sha256,
          row_count: 1,
        },
      ],
      assets: [],
      control_totals: {
        counts_by_type: { open_orders: 1 },
        stock_value: null,
        open_items: null,
        document_totals: [],
        domain_counts: {
          vehicle_parties: null,
          vehicle_due_dates: null,
          vehicle_notices: null,
          tyre_sets: null,
          open_orders: { ORDER: 1, QUOTE: 0, SCHEDULED: 0 },
          open_order_lines: null,
          legacy_documents: null,
          open_items: null,
        },
        open_orders_net: '1.00',
        open_items_as_of: null,
      },
    };

    const response = await request(app.getHttpServer())
      .post('/imports/canonical-migration/validate')
      .set('Authorization', authHeader)
      .attach('manifest', Buffer.from(JSON.stringify(manifest)), 'manifest.json')
      .attach('files', openOrdersCsv, 'open_orders.csv')
      .expect(201);

    expect(response.body.valid).toBe(false);
    expect(
      response.body.issues.some(
        (issue: { code?: string }) =>
          issue.code ===
          MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_INVALID_SCALAR_VALUE,
      ),
    ).toBe(true);
  });
});
