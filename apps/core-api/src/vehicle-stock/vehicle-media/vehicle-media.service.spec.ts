import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TenantContextService } from '../../common/services/tenant-context.service.js';
import { SiteContextService } from '../../site/site-context.service.js';
import { exifHasGpsIfd } from '../../common/media/exif-has-gps-ifd.js';
import {
  VEHICLE_MEDIA_STORAGE,
  type VehicleMediaStorage,
} from './vehicle-media.storage.js';
import { VehicleMediaService } from './vehicle-media.service.js';

const gpsFixture = new URL(
  '../../common/media/fixtures/gps-oriented.jpg',
  import.meta.url,
);

describe('VehicleMediaService', () => {
  const tenantId = 'tenant-1';
  const siteId = 'site-1';
  const vehicleId = 'vehicle-1';
  const otherVehicleId = 'vehicle-2';

  let service: VehicleMediaService;
  let prisma: {
    vehicle: { findFirst: jest.Mock };
    user: { findUnique: jest.Mock };
    tenantMember: { findFirst: jest.Mock };
    vehicleMedia: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      aggregate: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let storage: VehicleMediaStorage & {
    storeProcessedObject: jest.Mock;
    deleteObjects: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      vehicle: { findFirst: jest.fn() },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-1' }),
      },
      tenantMember: {
        findFirst: jest.fn().mockResolvedValue({ id: 'member-1' }),
      },
      vehicleMedia: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        aggregate: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn(async (cb) => cb(prisma)),
    };
    storage = {
      resolveBucket: () => 'test-bucket',
      objectPrefix: () => 'prefix/',
      readObject: jest.fn(),
      storeProcessedObject: jest
        .fn()
        .mockImplementation(async (params) =>
          `key/${params.variantName}.jpg`,
        ),
      deleteObjects: jest.fn(),
      deleteVehicleMediaPrefix: jest.fn(),
      deleteTenantVehicleMediaPrefix: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        VehicleMediaService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: TenantContextService,
          useValue: {
            getTenantId: async () => tenantId,
            getAuthenticatedUser: () => ({
              userId: 'firebase-user-1',
              email: 'test@test.local',
              tenantId,
              role: 'ADMIN',
            }),
          },
        },
        {
          provide: SiteContextService,
          useValue: { getSiteId: async () => siteId },
        },
        { provide: VEHICLE_MEDIA_STORAGE, useValue: storage },
      ],
    }).compile();

    service = moduleRef.get(VehicleMediaService);
    prisma.vehicle.findFirst.mockResolvedValue({ id: vehicleId, site_id: siteId });
  });

  it('rejects reorder lists with foreign photo ids', async () => {
    prisma.vehicleMedia.findMany.mockResolvedValue([{ id: 'photo-a' }]);
    await expect(
      service.reorder(vehicleId, ['photo-a', 'photo-b']),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('enforces a single cover when setting cover', async () => {
    prisma.vehicleMedia.findFirst.mockResolvedValue({
      id: 'photo-b',
      tenant_id: tenantId,
      vehicle_id: vehicleId,
    });
    prisma.vehicleMedia.update.mockResolvedValue({
      id: 'photo-b',
      vehicle_id: vehicleId,
      site_id: siteId,
      sort_order: 1,
      is_cover: true,
      content_type: 'image/jpeg',
      width: 10,
      height: 10,
      content_sha256: 'a'.repeat(64),
      variant_storage_keys: {},
      created_by_user_id: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.setCover(vehicleId, 'photo-b');

    expect(prisma.vehicleMedia.updateMany).toHaveBeenCalledWith({
      where: {
        tenant_id: tenantId,
        vehicle_id: vehicleId,
        is_cover: true,
      },
      data: { is_cover: false },
    });
  });

  it('strips EXIF when uploading a GPS fixture', async () => {
    const source = await readFile(gpsFixture);
    const before = await sharp(source).metadata();
    expect(exifHasGpsIfd(before.exif!)).toBe(true);

    prisma.vehicleMedia.aggregate.mockResolvedValue({ _max: { sort_order: 0 } });
    prisma.vehicleMedia.count.mockResolvedValue(1);
    prisma.vehicleMedia.create.mockImplementation(async ({ data }) => ({
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const file = {
      buffer: source,
      size: source.byteLength,
    } as Express.Multer.File;

    const dto = await service.upload(vehicleId, file);
    expect(dto.contentType).toBe('image/jpeg');
    expect(storage.storeProcessedObject).toHaveBeenCalled();
    for (const call of storage.storeProcessedObject.mock.calls) {
      const storedBytes = call[0].bytes as Buffer;
      const after = await sharp(storedBytes).metadata();
      expect(after.exif).toBeUndefined();
    }
  });

  it('does not delete the row when object storage delete fails', async () => {
    const row = {
      id: 'photo-1',
      tenant_id: tenantId,
      vehicle_id: vehicleId,
      storage_bucket: 'test-bucket',
      processed_storage_key: 'key/processed.jpg',
      variant_storage_keys: { portal_md: { storage_key: 'key/portal_md.jpg' } },
      is_cover: false,
    };
    prisma.vehicleMedia.findFirst.mockResolvedValue(row);
    storage.deleteObjects.mockRejectedValue(new Error('simulated GCS failure'));

    await expect(service.remove(vehicleId, 'photo-1')).rejects.toThrow(
      'simulated GCS failure',
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.vehicleMedia.delete).not.toHaveBeenCalled();
  });

  it('best-effort deletes uploaded objects when the DB insert fails', async () => {
    const source = await readFile(gpsFixture);
    prisma.vehicleMedia.aggregate.mockResolvedValue({ _max: { sort_order: 0 } });
    prisma.vehicleMedia.count.mockResolvedValue(0);
    prisma.$transaction.mockRejectedValue(new Error('unique cover conflict'));

    const file = {
      buffer: source,
      size: source.byteLength,
    } as Express.Multer.File;

    await expect(service.upload(vehicleId, file)).rejects.toThrow(
      'unique cover conflict',
    );

    expect(storage.deleteObjects).toHaveBeenCalledWith(
      'test-bucket',
      expect.arrayContaining([
        expect.stringMatching(/processed\.jpg$/),
        expect.stringMatching(/portal_md\.jpg$/),
        expect.stringMatching(/thumbnail\.jpg$/),
      ]),
    );
  });

  it('surfaces upload and cleanup failures together when both fail', async () => {
    const source = await readFile(gpsFixture);
    prisma.vehicleMedia.aggregate.mockResolvedValue({ _max: { sort_order: 0 } });
    prisma.vehicleMedia.count.mockResolvedValue(0);
    prisma.$transaction.mockRejectedValue(new Error('unique cover conflict'));
    storage.deleteObjects.mockRejectedValue(new Error('cleanup failed'));

    const file = {
      buffer: source,
      size: source.byteLength,
    } as Express.Multer.File;

    await expect(service.upload(vehicleId, file)).rejects.toMatchObject({
      name: 'AggregateError',
      message: expect.stringContaining('unique cover conflict'),
    });
  });

  it('promotes the next photo to cover inside the delete transaction', async () => {
    const row = {
      id: 'cover-photo',
      tenant_id: tenantId,
      vehicle_id: vehicleId,
      storage_bucket: 'test-bucket',
      processed_storage_key: 'key/processed.jpg',
      variant_storage_keys: {},
      is_cover: true,
    };
    prisma.vehicleMedia.findFirst
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce({ ...row, is_cover: true })
      .mockResolvedValueOnce({ id: 'next-photo', sort_order: 1 });
    storage.deleteObjects.mockResolvedValue(undefined);
    prisma.vehicleMedia.delete.mockResolvedValue(row);
    prisma.vehicleMedia.update.mockResolvedValue({
      id: 'next-photo',
      is_cover: true,
    });

    await service.remove(vehicleId, 'cover-photo');

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.vehicleMedia.update).toHaveBeenCalledWith({
      where: { tenant_id: tenantId, id: 'next-photo' },
      data: { is_cover: true },
    });
  });

  it('returns 404 for photos on another vehicle', async () => {
    prisma.vehicle.findFirst.mockResolvedValue(null);
    await expect(
      service.remove(otherVehicleId, 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
