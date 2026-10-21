import { ImportEntityType } from '@prisma/client';
import { expectedHeadersForFile } from './migration-csv-dictionary.js';
import type { MigrationCsvFileName } from './migration-csv-dictionary.js';

function identityMapping(headers: string[]): Record<string, string> {
  return Object.fromEntries(headers.map((header) => [header, header]));
}

const CUSTOMER_FILE: MigrationCsvFileName = 'customers.csv';
const VEHICLE_FILE: MigrationCsvFileName = 'vehicles.csv';
const LABOR_FILE: MigrationCsvFileName = 'labor_operations.csv';

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
  return {};
}
