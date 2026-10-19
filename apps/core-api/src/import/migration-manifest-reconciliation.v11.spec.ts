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

  it('blocks partial dry-run when open_orders_net is set but open_orders.csv is not uploaded', () => {
    const customers = headerOnlyCanonicalCsvBytes('customers.csv');
    const openOrders = headerOnlyCanonicalCsvBytes('open_orders.csv');
    const manifest = baseManifest({
      files: [
        {
          name: 'customers.csv',
          sha256: sha256Buffer(customers),
          row_count: 0,
        },
        {
          name: 'open_orders.csv',
          sha256: sha256Buffer(openOrders),
          row_count: 0,
        },
      ],
      counts: { customers: 0, open_orders: 0 },
      control_totals: {
        open_orders_net: '1.00',
      },
    });
    const issues = validateMigrationBundle({
      manifest,
      files: { 'customers.csv': customers },
      allowPartialFiles: true,
    });
    expect(
      issues.some(
        (issue) =>
          issue.code ===
            MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_NOT_RECONCILED &&
          issue.field === 'control_totals.open_orders_net',
      ),
    ).toBe(true);
  });

  it('reports invalid money during open_orders_net reconciliation', () => {
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
    const buffer = Buffer.from(
      `${parsedHeader.headers.join(',')}\r\n${cells.join(',')}\r\n`,
      'utf8',
    );
    const parsed = parseCanonicalMigrationCsv(buffer);
    const manifest = baseManifest({
      files: [
        {
          name: 'open_orders.csv',
          sha256: parsed.sha256,
          row_count: 1,
        },
      ],
      counts: { open_orders: 1 },
      control_totals: {
        open_orders_net: '1.00',
      },
    });
    const issues = validateMigrationBundle({
      manifest,
      files: { 'open_orders.csv': buffer },
    });
    expect(
      issues.some(
        (issue) =>
          issue.code ===
            MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_INVALID_SCALAR_VALUE &&
          issue.field === 'expected_net_total',
      ),
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

  it('format 1.0 requires document_totals empty when legacy_documents.csv is absent', () => {
    const customers = headerOnlyCanonicalCsvBytes('customers.csv');
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
          name: 'customers.csv',
          sha256: sha256Buffer(customers),
          row_count: 0,
        },
      ],
      control_totals: {
        counts_by_type: { customers: 0 },
        stock_value: null,
        open_items: '5.00',
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
    };
    const issues = validateMigrationBundle({
      manifest,
      files: { 'customers.csv': customers },
    });
    expect(
      issues.some((issue) => issue.field === 'control_totals.document_totals'),
    ).toBe(true);
    expect(
      issues.some((issue) => issue.field === 'control_totals.open_items'),
    ).toBe(true);
  });
});
