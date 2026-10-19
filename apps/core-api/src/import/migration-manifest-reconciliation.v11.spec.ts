import { MIGRATION_MANIFEST_ERROR_CODES } from './migration-manifest.errors.js';
import {
  headerOnlyCanonicalCsvBytes,
  parseCanonicalMigrationCsv,
  sha256Buffer,
} from './migration-csv-parse.util.js';
import { validateMigrationBundle } from './migration-manifest.validator.js';
import type { MigrationManifest } from './migration-manifest.types.js';

function baseManifest(
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
      ...(overrides.control_totals ?? {}),
    },
    ...overrides,
  };
}

describe('validateMigrationManifestReconciliationV11', () => {
  it('rejects open_orders_net when open_orders.csv is absent', () => {
    const customers = headerOnlyCanonicalCsvBytes('customers.csv');
    const manifest = baseManifest({
      files: [
        {
          name: 'customers.csv',
          sha256: sha256Buffer(customers),
          row_count: 0,
        },
      ],
      counts: { customers: 0 },
      control_totals: {
        open_orders_net: '1.00',
      },
    });
    const issues = validateMigrationBundle({
      manifest,
      files: { 'customers.csv': customers },
    });
    expect(
      issues.some(
        (issue) =>
          issue.field === 'control_totals.open_orders_net' &&
          issue.code ===
            MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_MISMATCH,
      ),
    ).toBe(true);
  });

  it('rejects domain_counts.tyre_sets when tyre_sets.csv is absent', () => {
    const customers = headerOnlyCanonicalCsvBytes('customers.csv');
    const manifest = baseManifest({
      files: [
        {
          name: 'customers.csv',
          sha256: sha256Buffer(customers),
          row_count: 0,
        },
      ],
      counts: { customers: 0 },
      control_totals: {
        domain_counts: {
          vehicle_parties: null,
          vehicle_due_dates: null,
          vehicle_notices: null,
          tyre_sets: {
            IN_STORAGE: 0,
            ON_VEHICLE: 0,
            RETURNED: 0,
            DISPOSED: 0,
          },
          open_orders: null,
          open_order_lines: null,
          legacy_documents: null,
          open_items: null,
        },
      },
    });
    const issues = validateMigrationBundle({
      manifest,
      files: { 'customers.csv': customers },
    });
    expect(
      issues.some((issue) => issue.message.includes('tyre_sets')),
    ).toBe(true);
  });

  it('rejects document_totals when legacy_documents has no invoice rows', () => {
    const buffer = headerOnlyCanonicalCsvBytes('legacy_documents.csv');
    const manifest = baseManifest({
      files: [
        {
          name: 'legacy_documents.csv',
          sha256: sha256Buffer(buffer),
          row_count: 0,
        },
      ],
      counts: { legacy_documents: 0 },
      control_totals: {
        document_totals: [
          {
            year_month: '2026-01',
            doc_type: 'INVOICE',
            row_count: 1,
            net: '1.00',
            vat: '0.20',
            gross: '1.20',
          },
        ],
      },
    });
    const issues = validateMigrationBundle({
      manifest,
      files: { 'legacy_documents.csv': buffer },
    });
    expect(
      issues.some((issue) => issue.field === 'control_totals.document_totals'),
    ).toBe(true);
  });
});
