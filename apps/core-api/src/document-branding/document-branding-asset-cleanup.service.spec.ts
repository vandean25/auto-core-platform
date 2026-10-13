import { PrismaService } from '../prisma/prisma.service.js';
import { DocumentBrandingAssetCleanupService } from './document-branding-asset-cleanup.service.js';
import { DocumentBrandingAssetStorage } from './document-branding-asset-storage.js';

describe('DocumentBrandingAssetCleanupService', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const expiredRow = {
    id: 'asset-1',
    tenant_id: 'tenant-1',
    legal_entity_id: 'entity-1',
    purpose: 'LOGO',
    state: 'READY',
    expires_at: new Date('2026-09-30T00:00:00Z'),
    bucket: 'private-branding',
    object_key: 'logo.png',
    object_generation: '1',
    quarantine_bucket: 'private-branding',
    quarantine_object_key: 'quarantine.png',
    quarantine_object_generation: '2',
    preview_bucket: 'private-branding',
    preview_object_key: 'preview.png',
    preview_object_generation: '3',
  };
  const expiredRef = {
    id: 'asset-1',
    tenant_id: 'tenant-1',
    legal_entity_id: 'entity-1',
  };

  let tx: Record<string, any>;
  let prisma: Record<string, any>;
  let storage: { deleteGeneration: jest.Mock };
  let service: DocumentBrandingAssetCleanupService;

  beforeEach(() => {
    jest.clearAllMocks();
    tx = {
      legalEntity: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'entity-1', is_active: true }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      documentBrandAsset: {
        findFirst: jest.fn(async ({ where }) => {
          if (where.source_asset_id) return null;
          return where.state === 'DELETING'
            ? { ...expiredRow, state: 'DELETING' }
            : expiredRow;
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      documentBrandProfile: { findFirst: jest.fn().mockResolvedValue(null) },
      invoiceBrandAssetReference: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      documentBrandExtraction: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    prisma = {
      documentBrandAsset: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (callback) => callback(tx)),
    };
    storage = { deleteGeneration: jest.fn().mockResolvedValue(undefined) };
    service = new DocumentBrandingAssetCleanupService(
      prisma as unknown as PrismaService,
      storage as unknown as DocumentBrandingAssetStorage,
    );
  });

  it('deletes every storage generation of an expired, unreferenced asset and marks it deleted', async () => {
    prisma.documentBrandAsset.findMany.mockResolvedValueOnce([expiredRef]);

    await service.purgeExpired(now);

    expect(storage.deleteGeneration.mock.calls).toEqual([
      ['private-branding', 'logo.png', '1'],
      ['private-branding', 'preview.png', '3'],
      ['private-branding', 'quarantine.png', '2'],
    ]);
    expect(prisma.documentBrandAsset.updateMany).toHaveBeenCalledWith({
      where: { id: 'asset-1', tenant_id: 'tenant-1', state: 'DELETING' },
      data: expect.objectContaining({
        state: 'DELETED',
        preview_bucket: null,
      }),
    });
  });

  it('keeps an expired asset that a brand profile still references', async () => {
    prisma.documentBrandAsset.findMany.mockResolvedValueOnce([expiredRef]);
    tx.documentBrandProfile.findFirst.mockResolvedValue({ id: 'profile-1' });

    await service.purgeExpired(now);

    expect(tx.documentBrandAsset.updateMany).not.toHaveBeenCalled();
    expect(storage.deleteGeneration).not.toHaveBeenCalled();
    expect(prisma.documentBrandAsset.updateMany).not.toHaveBeenCalled();
  });

  it('drops the quarantine copy of a published asset and clears its locator', async () => {
    prisma.documentBrandAsset.findMany.mockResolvedValueOnce([
      {
        id: 'asset-2',
        tenant_id: 'tenant-1',
        quarantine_bucket: 'private-branding',
        quarantine_object_key: 'quarantine.png',
        quarantine_object_generation: '5',
      },
    ]);

    await service.removeStaleQuarantineCopies();

    expect(storage.deleteGeneration).toHaveBeenCalledWith(
      'private-branding',
      'quarantine.png',
      '5',
    );
    expect(prisma.documentBrandAsset.updateMany).toHaveBeenCalledWith({
      where: { id: 'asset-2', tenant_id: 'tenant-1', state: 'READY' },
      data: {
        quarantine_bucket: null,
        quarantine_object_key: null,
        quarantine_object_generation: null,
      },
    });
  });
});
