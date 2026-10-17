import {
  getVehicleMediaPurgeStorage,
  registerVehicleMediaPurgeStorage,
} from './vehicle-media-purge.registry.js';
import type { VehicleMediaStorage } from './vehicle-media.storage.js';
import {
  requireVehicleMediaPurgeStorage,
  runVehicleDeleteManyWithMediaPurge,
  runVehicleDeleteWithMediaPurge,
} from './vehicle-media-purge.extension.js';

describe('vehicle-media-purge extension helpers', () => {
  const purgeStorage: VehicleMediaStorage = {
    resolveBucket: () => 'b',
    objectPrefix: () => 'p/',
    storeProcessedObject: async () => 'k',
    deleteObjects: async () => undefined,
    deleteVehicleMediaPrefix: jest.fn(),
    deleteTenantVehicleMediaPrefix: jest.fn(),
  };

  beforeEach(() => {
    registerVehicleMediaPurgeStorage(purgeStorage);
    jest.clearAllMocks();
  });

  it('does not purge storage when the vehicle delete fails', async () => {
    const vehicleDelegate = {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'vehicle-1', tenant_id: 'tenant-1' }]),
      findFirst: jest.fn().mockResolvedValue({ id: 'vehicle-1' }),
    };

    await expect(
      runVehicleDeleteWithMediaPurge(
        vehicleDelegate,
        { id: 'vehicle-1', tenant_id: 'tenant-1' },
        async () => {
          throw new Error('FK violation');
        },
      ),
    ).rejects.toThrow('FK violation');

    expect(purgeStorage.deleteVehicleMediaPrefix).not.toHaveBeenCalled();
  });

  it('purges storage only after a successful vehicle delete', async () => {
    const vehicleDelegate = {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'vehicle-1', tenant_id: 'tenant-1' }]),
      findFirst: jest.fn().mockResolvedValue(null),
    };

    await runVehicleDeleteWithMediaPurge(
      vehicleDelegate,
      { id: 'vehicle-1', tenant_id: 'tenant-1' },
      async () => ({ id: 'vehicle-1' }),
    );

    expect(purgeStorage.deleteVehicleMediaPrefix).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      vehicleId: 'vehicle-1',
    });
  });

  it('throws when purge storage is not registered', () => {
    registerVehicleMediaPurgeStorage(
      undefined as unknown as VehicleMediaStorage,
    );
    expect(getVehicleMediaPurgeStorage()).toBeUndefined();
    expect(() => requireVehicleMediaPurgeStorage()).toThrow(
      'Vehicle photo purge storage is not registered.',
    );
    registerVehicleMediaPurgeStorage(purgeStorage);
  });

  it('purges only vehicles removed by deleteMany', async () => {
    const vehicleDelegate = {
      findMany: jest.fn().mockResolvedValue([
        { id: 'vehicle-1', tenant_id: 'tenant-1' },
        { id: 'vehicle-2', tenant_id: 'tenant-1' },
      ]),
      findFirst: jest.fn().mockImplementation(async ({ where }) =>
        where.id === 'vehicle-1' ? null : { id: where.id },
      ),
    };

    await runVehicleDeleteManyWithMediaPurge(
      vehicleDelegate,
      { tenant_id: 'tenant-1' },
      async () => ({ count: 1 }),
    );

    expect(purgeStorage.deleteVehicleMediaPrefix).toHaveBeenCalledTimes(1);
    expect(purgeStorage.deleteVehicleMediaPrefix).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      vehicleId: 'vehicle-1',
    });
  });
});
