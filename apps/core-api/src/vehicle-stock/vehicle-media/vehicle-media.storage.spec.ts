import { InternalServerErrorException } from '@nestjs/common';
import { GcsVehicleMediaStorage } from './vehicle-media.storage.js';

describe('GcsVehicleMediaStorage.deleteObjects', () => {
  it('propagates storage errors instead of swallowing them', async () => {
    const storage = new GcsVehicleMediaStorage();
    const bucket = {
      file: () => ({
        delete: async () => {
          throw new Error('simulated GCS failure');
        },
      }),
    };
    (storage as unknown as { storage: { bucket: () => unknown } }).storage = {
      bucket: () => bucket,
    };

    await expect(
      storage.deleteObjects('test-bucket', ['tenants/t1/vehicles/v1/media/m1/processed.jpg']),
    ).rejects.toThrow('simulated GCS failure');
  });
});

describe('GcsVehicleMediaStorage.resolveBucket', () => {
  it('throws when no bucket env is configured', () => {
    const previousVehicle = process.env.VEHICLE_MEDIA_BUCKET;
    const previousWorkshop = process.env.WORKSHOP_MEDIA_BUCKET;
    delete process.env.VEHICLE_MEDIA_BUCKET;
    delete process.env.WORKSHOP_MEDIA_BUCKET;
    const storage = new GcsVehicleMediaStorage();
    expect(() => storage.resolveBucket()).toThrow(InternalServerErrorException);
    process.env.VEHICLE_MEDIA_BUCKET = previousVehicle;
    process.env.WORKSHOP_MEDIA_BUCKET = previousWorkshop;
  });
});
