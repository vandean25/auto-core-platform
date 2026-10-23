import { ImportEntityType } from '@prisma/client';
import { expectedHeadersForFile } from './migration-csv-dictionary.js';
import type { MigrationCsvFileName } from './migration-csv-dictionary.js';

function identityMapping(headers: string[]): Record<string, string> {
  return Object.fromEntries(headers.map((header) => [header, header]));
}

const CUSTOMER_FILE: MigrationCsvFileName = 'customers.csv';
const VEHICLE_FILE: MigrationCsvFileName = 'vehicles.csv';
const LABOR_FILE: MigrationCsvFileName = 'labor_operations.csv';
const PARTY_FILE: MigrationCsvFileName = 'vehicle_parties.csv';
const DUE_DATE_FILE: MigrationCsvFileName = 'vehicle_due_dates.csv';

export function buildCanonicalMigrationIdentityMapping(
  entityType: ImportEntityType,
): Record<string, string> {
  if (entityType === ImportEntityType.CUSTOMER) {
    return identityMapping(expectedHeadersForFile(CUSTOMER_FILE));
  }
  if (entityType === ImportEntityType.VEHICLE) {
    const vehicleHeaders = expectedHeadersForFile(VEHICLE_FILE);
    return identityMapping(vehicleHeaders);
  }
  if (entityType === ImportEntityType.LABOR_OPERATION) {
    return identityMapping(expectedHeadersForFile(LABOR_FILE));
  }
  if (entityType === ImportEntityType.VEHICLE_PARTY) {
    return identityMapping(expectedHeadersForFile(PARTY_FILE));
  }
  if (entityType === ImportEntityType.VEHICLE_DUE_DATE) {
    return identityMapping(expectedHeadersForFile(DUE_DATE_FILE));
  }
  return {};
}
