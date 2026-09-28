import { PrismaService } from '../prisma/prisma.service.js';
import { DocumentBrandingAssetStorage } from './document-branding-asset-storage.js';
import { DocumentBrandingUploadTaskService } from './document-branding-upload-task.service.js';
import { DocumentBrandingUploadRecoveryService } from './document-branding-upload-recovery.service.js';

describe('DocumentBrandingUploadRecoveryService', () => {
  const tenant = { id: 'tenant-1' };
  const prisma = {
    tenant: { findMany: jest.fn().mockResolvedValue([tenant]) },
    documentBrandQuotaEvent: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    documentBrandAsset: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  } as unknown as PrismaService;
  const storage = {
    deleteGeneration: jest.fn(),
  } as unknown as DocumentBrandingAssetStorage;
  const tasks = {
    enqueue: jest.fn().mockResolvedValue(undefined),
  } as unknown as DocumentBrandingUploadTaskService;
  let service: DocumentBrandingUploadRecoveryService;

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.tenant.findMany as jest.Mock).mockResolvedValue([tenant]);
    (prisma.documentBrandAsset.findMany as jest.Mock)
      .mockResolvedValueOnce([{ id: 'asset-1', tenant_id: 'tenant-1' }])
      .mockResolvedValueOnce([])
      .mockResolvedValue([]);
    service = new DocumentBrandingUploadRecoveryService(prisma, storage, tasks);
  });

  it('requeues only tenant-scoped quarantined assets and exhausts stale third attempts', async () => {
    await service.recoverAndClean();
    const query = (prisma.documentBrandAsset.findMany as jest.Mock).mock
      .calls[0][0];
    expect(query.where).toMatchObject({
      tenant_id: { in: ['tenant-1'] },
      state: 'QUARANTINED',
      validation_attempt_count: { lt: 3 },
    });
    expect(tasks.enqueue).toHaveBeenCalledWith({
      assetId: 'asset-1',
      tenantId: 'tenant-1',
    });
    expect(prisma.documentBrandAsset.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          validation_attempt_count: { gte: 3 },
        }),
        data: expect.objectContaining({
          state: 'REJECTED',
          failure_code: 'VALIDATION_RETRIES_EXHAUSTED',
        }),
      }),
    );
  });

  it('deletes the exact expired generation only after reference checks under the entity lock', async () => {
    (prisma.documentBrandAsset.findMany as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'asset-1', tenant_id: 'tenant-1', legal_entity_id: 'entity-1' },
      ])
      .mockResolvedValue([]);
    const current = {
      id: 'asset-1',
      tenant_id: 'tenant-1',
      legal_entity_id: 'entity-1',
      state: 'REJECTED',
      expires_at: new Date(Date.now() - 1_000),
      bucket: null,
      object_key: null,
      object_generation: null,
      quarantine_bucket: 'private-branding',
      quarantine_object_key: 'quarantine/asset-1',
      quarantine_object_generation: '123',
    };
    const txAssetFindFirst = jest
      .fn()
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(null);
    const txUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback) =>
      callback({
        legalEntity: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 'entity-1', is_active: true }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        documentBrandAsset: {
          findFirst: txAssetFindFirst,
          updateMany: txUpdateMany,
        },
        documentBrandProfile: { findFirst: jest.fn().mockResolvedValue(null) },
      }),
    );

    await service.recoverAndClean();
    expect(txUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          state: 'REJECTED',
          tenant_id: 'tenant-1',
        }),
        data: { state: 'DELETING' },
      }),
    );
    expect(storage.deleteGeneration).toHaveBeenCalledWith(
      'private-branding',
      'quarantine/asset-1',
      '123',
    );
    expect(prisma.documentBrandAsset.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: 'DELETED' }),
      }),
    );
  });

  it('fails closed when an expired asset is still referenced', async () => {
    (prisma.documentBrandAsset.findMany as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'asset-1', tenant_id: 'tenant-1', legal_entity_id: 'entity-1' },
      ])
      .mockResolvedValue([]);
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback) =>
      callback({
        legalEntity: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 'entity-1', is_active: true }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        documentBrandAsset: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'asset-1',
            state: 'REJECTED',
            expires_at: new Date(0),
          }),
          updateMany: jest.fn(),
        },
        documentBrandProfile: {
          findFirst: jest.fn().mockResolvedValue({ id: 'profile-1' }),
        },
      }),
    );
    await service.recoverAndClean();
    expect(storage.deleteGeneration).not.toHaveBeenCalled();
  });

  it('removes only a published asset quarantine copy after immutable publication', async () => {
    (prisma.documentBrandAsset.findMany as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'asset-1',
          tenant_id: 'tenant-1',
          quarantine_bucket: 'private-branding',
          quarantine_object_key: 'quarantine/asset-1',
          quarantine_object_generation: '123',
        },
      ]);
    await service.recoverAndClean();
    expect(storage.deleteGeneration).toHaveBeenCalledWith(
      'private-branding',
      'quarantine/asset-1',
      '123',
    );
    expect(prisma.documentBrandAsset.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'asset-1', tenant_id: 'tenant-1', state: 'READY' },
        data: {
          quarantine_bucket: null,
          quarantine_object_key: null,
          quarantine_object_generation: null,
        },
      }),
    );
  });
});
