#!/usr/bin/env node
/**
 * Deletes all vehicle stock photo objects for one tenant from object storage.
 * Run before tools/tenant-restore/purge-tenant-data.sql when purging a tenant.
 */
import { GcsVehicleMediaStorage } from '../src/vehicle-stock/vehicle-media/vehicle-media.storage.js';

const tenantId = process.argv[2]?.trim();
if (!tenantId) {
  console.error('Usage: node purge-tenant-vehicle-media-objects.mjs <tenant_id>');
  process.exit(1);
}

const storage = new GcsVehicleMediaStorage();
await storage.deleteTenantVehicleMediaPrefix(tenantId);
console.log(`Purged vehicle media objects for tenant ${tenantId}`);
