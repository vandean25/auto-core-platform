import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import {
  headerOnlyCanonicalCsvBytes,
  parseCanonicalMigrationCsv,
  sha256Buffer,
} from './migration-csv-parse.util.js';
import {
  parseMigrationManifestJson,
  validateMigrationBundle,
  type MigrationManifest,
} from './migration-manifest.validator.js';

const fixtureDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../test/fixtures/migration-csv-v1',
);

function loadFixture(name: string): Buffer {
  return readFileSync(join(fixtureDir, name));
}

function buildMinimalManifest(
  overrides: Partial<MigrationManifest> & {
    files: MigrationManifest['files'];
    counts: Record<string, number>;
  },
): MigrationManifest {
  return {
    format_version: '1.1',
    source_name: 'synthetic_dms',
    source_system: 'synthetic_dms:synth_fixture',
    source_company_code: 'synth_fixture',
    extracted_at: '2026-10-19T08:00:00Z',
    cutover_date: '2026-11-01',
    currency: 'EUR',
    files: overrides.files,
    assets: [],
    control_totals: {
      counts_by_type: overrides.counts,
      stock_value: null,
      open_items: null,
      document_totals: [],
      domain_counts: {
        vehicle_parties: null,
        vehicle_due_dates: null,
        vehicle_notices: null,
        tyre_sets: null,
        open_orders: null,
        open_order_lines: null,
        legacy_documents: null,
        open_items: null,
      },
      open_orders_net: null,
      open_items_as_of: null,
    },
    ...overrides,
  };
}

describe('validateMigrationBundle', () => {
  it('accepts the synthetic migration-csv-v1 fixture bundle', () => {
    const customers = loadFixture('customers.csv');
    const vehicles = loadFixture('vehicles.csv');
    const manifest = parseMigrationManifestJson(loadFixture('manifest.json'));
    const issues = validateMigrationBundle({
      manifest,
      files: {
        'customers.csv': customers,
        'vehicles.csv': vehicles,
      },
    });
    expect(issues).toEqual([]);
  });

  it('reports hash mismatch', () => {
    const customers = loadFixture('customers.csv');
    const manifest = buildMinimalManifest({
      files: [
        {
          name: 'customers.csv',
          sha256: createHash('sha256').update('wrong').digest('hex'),
          row_count: parseCanonicalMigrationCsv(customers).rowCount,
        },
      ],
      counts: {
        customers: parseCanonicalMigrationCsv(customers).rowCount,
      },
    });
    const issues = validateMigrationBundle({
      manifest,
      files: { 'customers.csv': customers },
    });
    expect(issues.some((i) => i.code === IMPORT_ERROR_CODES.MIGRATION_FILE_HASH_MISMATCH)).toBe(
      true,
    );
  });

  it('reports row count mismatch', () => {
    const customers = loadFixture('customers.csv');
    const parsed = parseCanonicalMigrationCsv(customers);
    const manifest = buildMinimalManifest({
      files: [
        {
          name: 'customers.csv',
          sha256: parsed.sha256,
          row_count: parsed.rowCount + 1,
        },
      ],
      counts: { customers: parsed.rowCount + 1 },
    });
    const issues = validateMigrationBundle({
      manifest,
      files: { 'customers.csv': customers },
    });
    expect(issues.some((i) => i.code === IMPORT_ERROR_CODES.MIGRATION_ROW_COUNT_MISMATCH)).toBe(
      true,
    );
  });

  it('reports unknown enum value', () => {
    const parsedHeader = parseCanonicalMigrationCsv(
      headerOnlyCanonicalCsvBytes('customers.csv'),
    );
    const cells = parsedHeader.headers.map((header) => {
      if (header === 'external_id') return 'cust-enum';
      if (header === 'type') return 'BOGUS';
      if (header === 'first_name') return 'Anna';
      if (header === 'last_name') return 'Example';
      if (header === 'has_open_matters') return 'false';
      if (header === 'privacy_objection') return 'false';
      if (header === 'mail_stop') return 'false';
      if (header === 'anonymized') return 'false';
      return '';
    });
    const buffer = Buffer.from(
      `${parsedHeader.headers.join(',')}\r\n${cells.join(',')}\r\n`,
      'utf8',
    );
    const parsed = parseCanonicalMigrationCsv(buffer);
    const manifest = buildMinimalManifest({
      files: [
        {
          name: 'customers.csv',
          sha256: parsed.sha256,
          row_count: 1,
        },
      ],
      counts: { customers: 1 },
    });
    const issues = validateMigrationBundle({
      manifest,
      files: { 'customers.csv': buffer },
    });
    expect(issues.some((i) => i.code === IMPORT_ERROR_CODES.MIGRATION_UNKNOWN_ENUM_VALUE)).toBe(
      true,
    );
  });

  it('reports missing required column in header', () => {
    const buffer = Buffer.from('external_id,type\r\n', 'utf8');
    const parsed = parseCanonicalMigrationCsv(buffer);
    const manifest = buildMinimalManifest({
      files: [
        {
          name: 'customers.csv',
          sha256: parsed.sha256,
          row_count: 0,
        },
      ],
      counts: { customers: 0 },
    });
    const issues = validateMigrationBundle({
      manifest,
      files: { 'customers.csv': buffer },
    });
    expect(
      issues.some((i) => i.code === IMPORT_ERROR_CODES.MIGRATION_MISSING_REQUIRED_COLUMN),
    ).toBe(true);
  });

  it('rejects unsupported format_version', () => {
    const customers = loadFixture('customers.csv');
    const parsed = parseCanonicalMigrationCsv(customers);
    const manifest = buildMinimalManifest({
      format_version: '2.0',
      files: [
        {
          name: 'customers.csv',
          sha256: parsed.sha256,
          row_count: parsed.rowCount,
        },
      ],
      counts: { customers: parsed.rowCount },
    });
    const issues = validateMigrationBundle({
      manifest,
      files: { 'customers.csv': customers },
    });
    expect(
      issues.some(
        (i) => i.code === IMPORT_ERROR_CODES.MIGRATION_UNSUPPORTED_FORMAT_VERSION,
      ),
    ).toBe(true);
  });

  it('rejects reserved outline files for format_version 1.0', () => {
    const parties = headerOnlyCanonicalCsvBytes('vehicle_parties.csv');
    const manifest: MigrationManifest = {
      format_version: '1.0',
      source_name: 'synthetic_dms',
      source_system: 'synthetic_dms:synth_fixture',
      source_company_code: 'synth_fixture',
      extracted_at: '2026-10-19T08:00:00Z',
      cutover_date: '2026-11-01',
      currency: 'EUR',
      files: [
        {
          name: 'vehicle_parties.csv',
          sha256: sha256Buffer(parties),
          row_count: 0,
        },
      ],
      control_totals: {
        counts_by_type: { vehicle_parties: 0 },
        stock_value: null,
        open_items: null,
        document_totals: [],
      },
    };
    const issues = validateMigrationBundle({
      manifest,
      files: { 'vehicle_parties.csv': parties },
    });
    expect(
      issues.some((i) => i.code === IMPORT_ERROR_CODES.MIGRATION_RESERVED_FILE_REJECTED),
    ).toBe(true);
  });
});
