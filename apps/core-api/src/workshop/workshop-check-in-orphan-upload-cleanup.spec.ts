import { WorkshopMediaPurpose } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { MechanicMediaStorage } from '../mechanic/mechanic-media.storage.js';
import { readWorkshopCheckInOrphanUploadPurgeConfig } from './workshop-check-in-orphan-upload-cleanup.config.js';
import {
  listOrphanCheckInUploadCandidates,
  purgeOrphanCheckInUpload,
} from './workshop-check-in-orphan-upload-cleanup.js';

describe('readWorkshopCheckInOrphanUploadPurgeConfig', () => {
  it('defaults to enabled with a 24h TTL', () => {
    const config = readWorkshopCheckInOrphanUploadPurgeConfig({});
    expect(config.enabled).toBe(true);
    expect(config.ttlMs).toBe(24 * 60 * 60 * 1000);
    expect(config.batchSize).toBe(20);
  });

  it('honours disable flag and TTL hours', () => {
    const config = readWorkshopCheckInOrphanUploadPurgeConfig({
      WORKSHOP_CHECK_IN_ORPHAN_UPLOAD_PURGE_ENABLED: 'false',
      WORKSHOP_CHECK_IN_ORPHAN_UPLOAD_TTL_HOURS: '48',
    });
    expect(config.enabled).toBe(false);
    expect(config.ttlMs).toBe(48 * 60 * 60 * 1000);
  });
});

describe('purgeOrphanCheckInUpload', () => {
  const tenantId = 'tenant-1';
  const mediaId = '51500000-0000-4000-8000-000000000562';
  const cutoff = new Date('2026-01-01T00:00:00.000Z');

  const lockedRow = {
    id: mediaId,
    purpose: WorkshopMediaPurpose.CHECK_IN,
    check_in_id: null,
    storage_bucket: 'bucket-a',
    storage_key: 'key-a',
    createdAt: new Date('2025-12-01T00:00:00.000Z'),
  };

  function createPrismaMock(options: {
    lockRows: Array<
      (Omit<typeof lockedRow, 'check_in_id'> & { check_in_id: string | null }) | null
    >;
    existsAfter?: boolean;
  }) {
    let lockCall = 0;
    const deleteMock = jest.fn().mockResolvedValue(undefined);
    const findFirstMock = jest.fn().mockImplementation(() =>
      Promise.resolve(
        options.existsAfter === false ? null : { id: mediaId },
      ),
    );
    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const row = options.lockRows[lockCall] ?? null;
        lockCall += 1;
        return fn({
          $queryRaw: jest.fn().mockResolvedValue(row ? [row] : []),
          workshopMedia: { delete: deleteMock },
        });
      }),
      workshopMedia: {
        findFirst: findFirstMock,
        findMany: jest.fn(),
      },
    } as unknown as PrismaService;
    return { prisma, deleteMock };
  }

  it('deletes storage before the row when the object is removed', async () => {
    const { prisma, deleteMock } = createPrismaMock({
      lockRows: [lockedRow, lockedRow],
      existsAfter: false,
    });
    const order: string[] = [];
    const mediaStorage = {
      deleteObjectOrIgnoreNotFound: jest.fn().mockImplementation(async () => {
        order.push('storage');
      }),
    } as unknown as MechanicMediaStorage;
    deleteMock.mockImplementation(async () => {
      order.push('row');
    });

    const result = await purgeOrphanCheckInUpload(
      prisma,
      mediaStorage,
      tenantId,
      mediaId,
      cutoff,
    );
    expect(result).toEqual({ outcome: 'deleted' });
    expect(order).toEqual(['storage', 'row']);
    expect(mediaStorage.deleteObjectOrIgnoreNotFound).toHaveBeenCalledWith(
      'bucket-a',
      'key-a',
    );
  });

  it('deletes the row when storage reports not-found (already gone)', async () => {
    const { prisma, deleteMock } = createPrismaMock({
      lockRows: [lockedRow, lockedRow],
      existsAfter: false,
    });
    const mediaStorage = {
      deleteObjectOrIgnoreNotFound: jest.fn().mockResolvedValue(undefined),
    } as unknown as MechanicMediaStorage;

    const result = await purgeOrphanCheckInUpload(
      prisma,
      mediaStorage,
      tenantId,
      mediaId,
      cutoff,
    );
    expect(result).toEqual({ outcome: 'deleted' });
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the row when storage delete throws', async () => {
    const { prisma, deleteMock } = createPrismaMock({
      lockRows: [lockedRow],
      existsAfter: true,
    });
    const mediaStorage = {
      deleteObjectOrIgnoreNotFound: jest
        .fn()
        .mockRejectedValue(new Error('GCS unavailable')),
    } as unknown as MechanicMediaStorage;

    const result = await purgeOrphanCheckInUpload(
      prisma,
      mediaStorage,
      tenantId,
      mediaId,
      cutoff,
    );
    expect(result).toEqual({ outcome: 'storage_failed' });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('is idempotent when the row was already deleted', async () => {
    const { prisma, deleteMock } = createPrismaMock({
      lockRows: [null],
      existsAfter: false,
    });
    const mediaStorage = {
      deleteObjectOrIgnoreNotFound: jest.fn(),
    } as unknown as MechanicMediaStorage;

    const result = await purgeOrphanCheckInUpload(
      prisma,
      mediaStorage,
      tenantId,
      mediaId,
      cutoff,
    );
    expect(result).toEqual({ outcome: 'missing' });
    expect(deleteMock).not.toHaveBeenCalled();
    expect(mediaStorage.deleteObjectOrIgnoreNotFound).not.toHaveBeenCalled();
  });

  it('skips when the row was attached to a check-in under the lock', async () => {
    const attached = { ...lockedRow, check_in_id: 'check-in-1' };
    const { prisma } = createPrismaMock({
      lockRows: [attached],
      existsAfter: true,
    });
    const mediaStorage = {
      deleteObjectOrIgnoreNotFound: jest.fn(),
    } as unknown as MechanicMediaStorage;

    const result = await purgeOrphanCheckInUpload(
      prisma,
      mediaStorage,
      tenantId,
      mediaId,
      cutoff,
    );
    expect(result).toEqual({ outcome: 'skipped' });
    expect(mediaStorage.deleteObjectOrIgnoreNotFound).not.toHaveBeenCalled();
  });
});

describe('listOrphanCheckInUploadCandidates', () => {
  it('scopes by tenant and unattached check-in purposes', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      workshopMedia: { findMany },
    } as unknown as PrismaService;
    const cutoff = new Date('2026-01-01T00:00:00.000Z');

    await listOrphanCheckInUploadCandidates(prisma, 'tenant-a', cutoff, 10);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        tenant_id: 'tenant-a',
        check_in_id: null,
        purpose: {
          in: [
            WorkshopMediaPurpose.CHECK_IN,
            WorkshopMediaPurpose.CHECK_IN_SIGNATURE,
          ],
        },
        createdAt: { lt: cutoff },
      },
      orderBy: { createdAt: 'asc' },
      take: 10,
      select: {
        id: true,
        storage_bucket: true,
        storage_key: true,
        createdAt: true,
      },
    });
  });
});
