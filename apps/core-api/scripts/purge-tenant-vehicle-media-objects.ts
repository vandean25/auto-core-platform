/**
 * Deletes all vehicle stock photo objects for one tenant from object storage.
 * Run before tools/tenant-restore/purge-tenant-data.sql when purging a tenant.
 *
 * Usage (from repository root):
 *   npm run purge:tenant-vehicle-media --workspace=core-api -- <tenant_id>
 */
import { GcsVehicleMediaStorage } from '../src/vehicle-stock/vehicle-media/vehicle-media.storage.js';
import { isDirectRun } from './is-direct-run.mjs';

export async function purgeTenantVehicleMediaObjects(
  tenantId: string,
): Promise<void> {
  const storage = new GcsVehicleMediaStorage();
  await storage.deleteTenantVehicleMediaPrefix(tenantId);
}

async function main(): Promise<void> {
  const tenantId = process.argv[2]?.trim();
  if (!tenantId) {
    console.error(
      'Usage: npm run purge:tenant-vehicle-media --workspace=core-api -- <tenant_id>',
    );
    process.exit(1);
  }
  await purgeTenantVehicleMediaObjects(tenantId);
  console.log(`Purged vehicle media objects for tenant ${tenantId}`);
}

if (isDirectRun(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
