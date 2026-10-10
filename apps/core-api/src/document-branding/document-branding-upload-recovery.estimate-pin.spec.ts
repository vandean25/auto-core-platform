import { RequestContextService } from '../common/services/request-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { DocumentBrandingAssetStorage } from './document-branding-asset-storage.js';
import { DocumentBrandingUploadTaskService } from './document-branding-upload-task.service.js';
import { DocumentBrandingUploadRecoveryService } from './document-branding-upload-recovery.service.js';

/**
 * A logo that a sent workshop estimate version pins (ADR-0025 §3) must survive the
 * cleanup. The pin is the `workshopEstimateReferences: { none: {} }` filter on the
 * DELETING transition and on the confirm read, so a reference committed before
 * either statement blocks the delete. The estimate reference is not read separately.
 */
describe('DocumentBrandingUploadRecoveryService estimate pin', () => {
  const expiredAsset = {
    id: 'asset-1',
    tenant_id: 'tenant-1',
    legal_entity_id: 'entity-1',
    state: 'REJECTED',
    expires_at: new Date(Date.now() - 1_000),
    bucket: 'private-branding',
    object_key:
      'tenants/tenant-1/legal-entities/entity-1/document-branding/assets/asset-1.pdf',
    object_generation: '456',
    quarantine_bucket: null,
    quarantine_object_key: null,
    quarantine_object_generation: null,
    preview_bucket: null,
    preview_object_key: null,
    preview_object_generation: null,
  };
  const pinFilter = { workshopEstimateReferences: { none: {} } };
  const systemPrisma = {
    tenant: { findMany: jest.fn().mockResolvedValue([{ id: 'tenant-1' }]) },
  } as unknown as SystemPrismaService;
  const prisma = {
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

  let txAssetUpdateMany: jest.Mock;
  let txAssetFindFirst: jest.Mock;

  /** One cleanup pass over the expired asset. `markCount` is what the DELETING transition reports. */
  async function runCleanup(options: { markCount: number; confirmRow: boolean }) {
    (prisma.documentBrandAsset.findMany as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'asset-1', tenant_id: 'tenant-1', legal_entity_id: 'entity-1' },
      ])
      .mockResolvedValue([]);
    txAssetUpdateMany = jest.fn().mockResolvedValue({ count: options.markCount });
    txAssetFindFirst = jest.fn(({ where }) => {
      if (where.source_asset_id) return Promise.resolve(null);
      if (where.state === 'DELETING') {
        return Promise.resolve(
          options.confirmRow ? { ...expiredAsset, state: 'DELETING' } : null,
        );
      }
      return Promise.resolve(expiredAsset);
    });
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
          updateMany: txAssetUpdateMany,
        },
        documentBrandProfile: { findFirst: jest.fn().mockResolvedValue(null) },
        invoiceBrandAssetReference: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        documentBrandExtraction: {
          findFirst: jest.fn().mockResolvedValue(null),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      }),
    );
    const service = new DocumentBrandingUploadRecoveryService(
      prisma,
      systemPrisma,
      new RequestContextService(),
      storage,
      tasks,
    );
    await service.recoverAndClean();
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('marks and confirms an expired logo only while no sent estimate version pins it', async () => {
    await runCleanup({ markCount: 1, confirmRow: true });

    expect(txAssetUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining(pinFilter),
        data: { state: 'DELETING' },
      }),
    );
    expect(txAssetFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ state: 'DELETING', ...pinFilter }),
      }),
    );
    expect(storage.deleteGeneration).toHaveBeenCalledWith(
      'private-branding',
      expiredAsset.object_key,
      '456',
    );
  });

  it('keeps pinned logos out of the expired scan so they are not re-selected on every run', async () => {
    await runCleanup({ markCount: 1, confirmRow: true });

    const expiredScan = (prisma.documentBrandAsset.findMany as jest.Mock).mock.calls.find(
      ([query]) => query.where.expires_at !== undefined,
    );
    expect(expiredScan?.[0].where).toMatchObject(pinFilter);
  });

  it('keeps the logo when the DELETING transition matches no row because a sent estimate pins it', async () => {
    await runCleanup({ markCount: 0, confirmRow: true });

    expect(txAssetFindFirst).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ state: 'DELETING' }),
      }),
    );
    expect(storage.deleteGeneration).not.toHaveBeenCalled();
  });

  it('keeps the logo when the confirm read no longer finds it unpinned', async () => {
    await runCleanup({ markCount: 1, confirmRow: false });

    expect(storage.deleteGeneration).not.toHaveBeenCalled();
  });
});
