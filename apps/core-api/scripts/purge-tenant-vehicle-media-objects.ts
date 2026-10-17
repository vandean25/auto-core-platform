/**
 * Deletes all vehicle stock photo objects for one tenant from object storage.
 * Run before tools/tenant-restore/purge-tenant-data.sql when purging a tenant.
 *
 * Usage (from repository root):
 *   npm run purge:tenant-vehicle-media --workspace=core-api -- <tenant_id>
 */
import { GcsVehicleMediaStorage } from '../src/vehicle-stock/vehicle-media/vehicle-media.storage.js';
import type { VehicleMediaStorage } from '../src/vehicle-stock/vehicle-media/vehicle-media.storage.js';
import { isDirectRun } from './is-direct-run.mjs';

export function parsePurgeTenantVehicleMediaArgv(
  argv: string[],
): string {
  const tenantId = argv[2]?.trim();
  if (!tenantId) {
    throw new Error(
      'Usage: npm run purge:tenant-vehicle-media --workspace=core-api -- <tenant_id>',
    );
  }
  return tenantId;
}

export async function purgeTenantVehicleMediaObjects(
  tenantId: string,
  storage: Pick<VehicleMediaStorage, 'deleteTenantVehicleMediaPrefix'> = new GcsVehicleMediaStorage(),
): Promise<void> {
  await storage.deleteTenantVehicleMediaPrefix(tenantId);
}

export async function runPurgeTenantVehicleMediaCli(
  argv: string[] = process.argv,
  storage?: Pick<VehicleMediaStorage, 'deleteTenantVehicleMediaPrefix'>,
): Promise<void> {
  const tenantId = parsePurgeTenantVehicleMediaArgv(argv);
  await purgeTenantVehicleMediaObjects(tenantId, storage);
}

if (
  isDirectRun({
    moduleUrl: import.meta.url,
    moduleFilename: import.meta.filename,
    argv1: process.argv[1],
  })
) {
  runPurgeTenantVehicleMediaCli()
    .then(() => {
      console.log(
        `Purged vehicle media objects for tenant ${parsePurgeTenantVehicleMediaArgv(process.argv)}`,
      );
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error(
        error instanceof Error ? error.message : `Unexpected error: ${String(error)}`,
      );
      process.exit(1);
    });
}
