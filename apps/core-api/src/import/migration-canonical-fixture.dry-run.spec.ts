import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImportEntityType } from '@prisma/client';
import { parseCsvFile, rowToRecord } from './csv-parse.util.js';
import { buildCanonicalMigrationIdentityMapping } from './canonical-migration-preset.js';
import { normalizeCustomerRow, planCustomerDryRunRow } from './customer-import.logic.js';
import { normalizeVehicleRow } from './vehicle-import-normalize.row.js';
import { planVehicleDryRunRow } from './vehicle-import-plan.row.js';
import type { CustomerMatchContext } from './customer-import.logic.js';
import type { VehicleMatchContext } from './vehicle-import-plan.row.js';

const fixtureDir = join(process.cwd(), 'test/fixtures/migration-csv-v1');

function emptyCustomerContext(): CustomerMatchContext {
  return {
    mappingByExternalId: new Map(),
    customerByEmail: new Map(),
    customerById: new Map(),
    duplicateNameKeys: new Set(),
    externalIdSeenInFile: new Map(),
    emailSeenInFile: new Map(),
  };
}

function emptyVehicleContext(): VehicleMatchContext {
  return {
    mappingByExternalId: new Map(),
    vehicleByVin: new Map(),
    vehicleByPlate: new Map(),
    vehicleById: new Map(),
    customerExternalToEntityId: new Map([
      ['cust-001', 'c-001'],
      ['cust-002', 'c-002'],
      ['cust-missing', ''],
    ]),
    vinSeenInFile: new Map(),
    externalIdSeenInFile: new Map(),
  };
}

describe('migration-csv-v1 fixture dry-run totals', () => {
  it('matches expected customer CREATE/ERROR/SKIP counts', () => {
    const buffer = readFileSync(join(fixtureDir, 'customers.csv'));
    const parsed = parseCsvFile(buffer);
    const mapping = buildCanonicalMigrationIdentityMapping(
      ImportEntityType.CUSTOMER,
    );
    const context = emptyCustomerContext();
    const options = { invalid_vat_as_error: false };
    const totals = { create: 0, error: 0, skip: 0, rows: 0 };

    parsed.rows.forEach((cells, index) => {
      const record = rowToRecord(parsed.headers, cells);
      const normalized = normalizeCustomerRow(record, mapping, options);
      const planned = planCustomerDryRunRow(
        index + 1,
        normalized.row!,
        context,
        options,
        normalized.warnings,
      );
      totals.rows += 1;
      if (planned.action === 'CREATE') totals.create += 1;
      if (planned.action === 'ERROR') totals.error += 1;
      if (planned.action === 'SKIP') totals.skip += 1;
    });

    expect(totals).toEqual({ rows: 8, create: 7, error: 1, skip: 0 });
  });

  it('matches expected vehicle CREATE/ERROR counts with allow_missing_vin', () => {
    const buffer = readFileSync(join(fixtureDir, 'vehicles.csv'));
    const parsed = parseCsvFile(buffer);
    const mapping = buildCanonicalMigrationIdentityMapping(
      ImportEntityType.VEHICLE,
    );
    const context = emptyVehicleContext();
    const options = { allow_missing_vin: true };
    const totals = { create: 0, error: 0, skip: 0, rows: 0, warnings: 0 };

    parsed.rows.forEach((cells, index) => {
      const record = rowToRecord(parsed.headers, cells);
      const normalized = normalizeVehicleRow(record, mapping, options);
      if (!normalized.row) {
        totals.rows += 1;
        totals.error += 1;
        return;
      }
      const planned = planVehicleDryRunRow(
        index + 1,
        normalized.row,
        context,
        options,
        normalized.warnings,
      );
      totals.rows += 1;
      if (planned.action === 'CREATE') totals.create += 1;
      if (planned.action === 'ERROR') totals.error += 1;
      if (planned.action === 'SKIP') totals.skip += 1;
      if ((planned.warnings?.length ?? 0) > 0) totals.warnings += 1;
    });

    expect(totals.rows).toBe(6);
    expect(totals.create).toBe(3);
    expect(totals.error).toBe(3);
    expect(totals.warnings).toBe(1);
  });
});
