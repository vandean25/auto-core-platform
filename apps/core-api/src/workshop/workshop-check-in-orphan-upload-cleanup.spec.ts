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

  function createPrismaMock(
    locked: typeof lockedRow | null,
    existsAfter: boolean,
  ) {
    const deleteMock = jest.fn().mockResolvedValue(lockedRow);
    const findFirstMock = jest
      .fn()
      .mockResolvedValue(existsAfter ? { id: mediaId } : null);
    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          $queryRaw: jest.fn().mockResolvedValue(locked ? [locked] : []),
          workshopMedia: { delete: deleteMock },
        }),
      ),
      workshopMedia: {
        findFirst: findFirstMock,
        findMany: jest.fn(),
      },
    } as unknown as PrismaService;
    return { prisma, deleteMock, findFirstMock };
  }

  it('deletes the row before storage and is idempotent on missing rows', async () => {
    const { prisma, deleteMock } = createPrismaMock(lockedRow, false);
    const mediaStorage = {
      deleteObjectIfExists: jest.fn().mockResolvedValue(undefined),
    } as unknown as MechanicMediaStorage;

    const result = await purgeOrphanCheckInUpload(
      prisma,
      mediaStorage,
      tenantId,
      mediaId,
      cutoff,
    );
    expect(result).toEqual({ outcome: 'deleted' });
    expect(deleteMock).toHaveBeenCalledWith({
      where: { tenant_id: tenantId, id: mediaId },
    });
    expect(mediaStorage.deleteObjectIfExists).toHaveBeenCalledWith(
      'bucket-a',
      'key-a',
    );
  });

  it('skips when the row was attached to a check-in under the lock', async () => {
    const attached = { ...lockedRow, check_in_id: 'check-in-1' };
    const { prisma } = createPrismaMock(attached, true);
    const mediaStorage = {
      deleteObjectIfExists: jest.fn(),
    } as unknown as MechanicMediaStorage;

    const result = await purgeOrphanCheckInUpload(
      prisma,
      mediaStorage,
      tenantId,
      mediaId,
      cutoff,
    );
    expect(result).toEqual({ outcome: 'skipped' });
    expect(mediaStorage.deleteObjectIfExists).not.toHaveBeenCalled();
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
