import {
  getVehicleMediaPurgeStorage,
  registerVehicleMediaPurgeStorage,
} from './vehicle-media-purge.registry.js';
import type { VehicleMediaStorage } from './vehicle-media.storage.js';
import {
  requireVehicleMediaPurgeStorage,
  resolveVehiclesToPurgeAfterDeleteMany,
  runVehicleDeleteManyWithMediaPurge,
  runVehicleDeleteWithMediaPurge,
  runWithDeferredVehicleMediaPurges,
  scheduleVehicleMediaPrefixPurges,
} from './vehicle-media-purge.extension.js';

describe('vehicle-media-purge extension helpers', () => {
  const purgeStorage: VehicleMediaStorage = {
    resolveBucket: () => 'b',
    objectPrefix: () => 'p/',
    readObject: jest.fn(),
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
      findFirst: jest.fn(),
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

  it('purges storage after a successful vehicle delete without re-querying', async () => {
    const vehicleDelegate = {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'vehicle-1', tenant_id: 'tenant-1' }]),
      findFirst: jest.fn(),
    };

    await runVehicleDeleteWithMediaPurge(
      vehicleDelegate,
      { id: 'vehicle-1', tenant_id: 'tenant-1' },
      async () => ({ id: 'vehicle-1' }),
    );

    expect(vehicleDelegate.findFirst).not.toHaveBeenCalled();
    expect(purgeStorage.deleteVehicleMediaPrefix).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      vehicleId: 'vehicle-1',
    });
  });

  it('throws before delete when purge storage is not registered', async () => {
    registerVehicleMediaPurgeStorage(
      undefined as unknown as VehicleMediaStorage,
    );
    const query = jest.fn();
    await expect(
      runVehicleDeleteWithMediaPurge(
        {
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: 'vehicle-1', tenant_id: 'tenant-1' }]),
          findFirst: jest.fn(),
        },
        { id: 'vehicle-1' },
        query,
      ),
    ).rejects.toThrow('Vehicle photo purge storage is not registered.');
    expect(query).not.toHaveBeenCalled();
    registerVehicleMediaPurgeStorage(purgeStorage);
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

  it('enqueues purge during a deferred transaction and flushes after commit', async () => {
    await runWithDeferredVehicleMediaPurges(async () => {
      await scheduleVehicleMediaPrefixPurges([
        { id: 'vehicle-1', tenant_id: 'tenant-1' },
      ]);
      expect(purgeStorage.deleteVehicleMediaPrefix).not.toHaveBeenCalled();
    });

    expect(purgeStorage.deleteVehicleMediaPrefix).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      vehicleId: 'vehicle-1',
    });
  });

  it('discards enqueued purges when deferred work rejects', async () => {
    await expect(
      runWithDeferredVehicleMediaPurges(async () => {
        await scheduleVehicleMediaPrefixPurges([
          { id: 'vehicle-1', tenant_id: 'tenant-1' },
        ]);
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');

    expect(purgeStorage.deleteVehicleMediaPrefix).not.toHaveBeenCalled();
  });

  it('rejects when post-commit purge fails', async () => {
    jest.mocked(purgeStorage.deleteVehicleMediaPrefix).mockRejectedValueOnce(
      new Error('storage down'),
    );

    await expect(
      runWithDeferredVehicleMediaPurges(async () => {
        await scheduleVehicleMediaPrefixPurges([
          { id: 'vehicle-1', tenant_id: 'tenant-1' },
        ]);
      }),
    ).rejects.toThrow('storage down');
  });

  it('purges using the transaction delegate when deleteMany count is partial', async () => {
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

  it('skips follow-up reads when deleteMany count matches candidates', async () => {
    const candidates = [
      { id: 'vehicle-1', tenant_id: 'tenant-1' },
      { id: 'vehicle-2', tenant_id: 'tenant-1' },
    ];
    const vehicleDelegate = {
      findMany: jest.fn().mockResolvedValue(candidates),
      findFirst: jest.fn(),
    };

    const toPurge = await resolveVehiclesToPurgeAfterDeleteMany(
      candidates,
      2,
      vehicleDelegate,
    );

    expect(toPurge).toEqual(candidates);
    expect(vehicleDelegate.findFirst).not.toHaveBeenCalled();
  });
});
