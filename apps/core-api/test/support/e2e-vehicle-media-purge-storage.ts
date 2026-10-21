import type { VehicleMediaStorage } from '../../src/vehicle-stock/vehicle-media/vehicle-media.storage.js';

/** Avoids real GCS calls from the vehicle delete purge hook in most e2e suites. */
export const e2eVehicleMediaPurgeStorage: VehicleMediaStorage = {
  resolveBucket: () => 'e2e-vehicle-media',
  readObject: async () => {
    throw new Error('readObject is not stubbed in the e2e purge storage');
  },
  objectPrefix: () => 'prefix/',
  storeProcessedObject: async () => 'key',
  deleteObjects: async () => undefined,
  deleteVehicleMediaPrefix: async () => undefined,
  deleteTenantVehicleMediaPrefix: async () => undefined,
};
