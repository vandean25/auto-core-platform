import type { VehicleMediaStorage } from './vehicle-media.storage.js';

let registeredStorage: VehicleMediaStorage | undefined;

export function registerVehicleMediaPurgeStorage(
  storage: VehicleMediaStorage,
): void {
  registeredStorage = storage;
}

export function getVehicleMediaPurgeStorage(): VehicleMediaStorage | undefined {
  return registeredStorage;
}
