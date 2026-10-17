import { isDirectRun } from './is-direct-run.mjs';
import {
  parsePurgeTenantVehicleMediaArgv,
  purgeTenantVehicleMediaObjects,
  runPurgeTenantVehicleMediaCli,
} from './purge-tenant-vehicle-media-objects.js';

describe('purge-tenant-vehicle-media-objects script', () => {
  it('parses tenant id from argv', () => {
    expect(parsePurgeTenantVehicleMediaArgv(['node', 'script.ts', 'tenant-42'])).toBe(
      'tenant-42',
    );
  });

  it('rejects missing tenant id', () => {
    expect(() => parsePurgeTenantVehicleMediaArgv(['node', 'script.ts'])).toThrow(
      'Usage: npm run purge:tenant-vehicle-media',
    );
  });

  it('purges tenant prefix via injected storage', async () => {
    const storage = {
      deleteTenantVehicleMediaPrefix: jest.fn().mockResolvedValue(undefined),
    };
    await purgeTenantVehicleMediaObjects('tenant-42', storage);
    expect(storage.deleteTenantVehicleMediaPrefix).toHaveBeenCalledWith('tenant-42');
  });

  it('runs CLI main path with injected storage', async () => {
    const storage = {
      deleteTenantVehicleMediaPrefix: jest.fn().mockResolvedValue(undefined),
    };
    await runPurgeTenantVehicleMediaCli(
      ['node', 'purge-tenant-vehicle-media-objects.ts', 'tenant-99'],
      storage,
    );
    expect(storage.deleteTenantVehicleMediaPrefix).toHaveBeenCalledWith('tenant-99');
  });

  it('is a direct run when executed as the process entry module', () => {
    expect(
      isDirectRun({
        moduleUrl: import.meta.url,
        moduleFilename: import.meta.filename,
        argv1: import.meta.filename,
      }),
    ).toBe(true);
  });
});
