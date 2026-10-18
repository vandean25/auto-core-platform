import { jest } from '@jest/globals';
import { registerVehicleMediaPurgeStorage } from '../src/vehicle-stock/vehicle-media/vehicle-media-purge.registry.js';
import { e2eVehicleMediaPurgeStorage } from './support/e2e-vehicle-media-purge-storage.js';

Object.assign(globalThis, { jest });

registerVehicleMediaPurgeStorage(e2eVehicleMediaPurgeStorage);

const e2eSpecPaths = process.argv.filter((arg) => arg.includes('e2e-spec'));
const runsLegacyMcpE2e = e2eSpecPaths.some((arg) =>
  arg.endsWith('mcp.e2e-spec.ts'),
);
const runsComplianceMcpE2e = e2eSpecPaths.some((arg) =>
  arg.includes('mcp-compliance-reads.aut605'),
);
if (runsLegacyMcpE2e && !runsComplianceMcpE2e) {
  process.env.MCP_E2E_LEGACY_STACK = 'true';
}

if (
  !process.env.VEHICLE_MEDIA_BUCKET?.trim() &&
  !process.env.WORKSHOP_MEDIA_BUCKET?.trim()
) {
  process.env.WORKSHOP_MEDIA_BUCKET = 'test-workshop-media-bucket';
}
