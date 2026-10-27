import { jest } from '@jest/globals';
import { registerVehicleMediaPurgeStorage } from '../src/vehicle-stock/vehicle-media/vehicle-media-purge.registry.js';
import { e2eVehicleMediaPurgeStorage } from './support/e2e-vehicle-media-purge-storage.js';

Object.assign(globalThis, { jest });

registerVehicleMediaPurgeStorage(e2eVehicleMediaPurgeStorage);

if (
  !process.env.VEHICLE_MEDIA_BUCKET?.trim() &&
  !process.env.WORKSHOP_MEDIA_BUCKET?.trim()
) {
  process.env.WORKSHOP_MEDIA_BUCKET = 'test-workshop-media-bucket';
}

if (!process.env.IMPORT_UPLOAD_STORAGE?.trim()) {
  process.env.IMPORT_UPLOAD_STORAGE = 'local';
}

if (!process.env.IMPORT_WORKER_BATCH_SIZE?.trim()) {
  process.env.IMPORT_WORKER_BATCH_SIZE = '2';
}
