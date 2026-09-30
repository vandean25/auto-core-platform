import { RequestContextService } from '../common/services/request-context.service.js';
import { TenantContextStorage } from '../common/services/tenant-context.storage.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { DocumentBrandingAssetStorage } from './document-branding-asset-storage.js';
import { DocumentBrandingUploadTaskService } from './document-branding-upload-task.service.js';
import { DocumentBrandingUploadRecoveryService } from './document-branding-upload-recovery.service.js';

describe('DocumentBrandingUploadRecoveryService', () => {
  const tenant = { id: 'tenant-1' };
  const systemPrisma = {
    tenant: { findMany: jest.fn().mockResolvedValue([tenant]) },
  } as unknown as SystemPrismaService;
  const requestContext = new RequestContextService();
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
  let service: DocumentBrandingUploadRecoveryService;

  beforeEach(() => {
    jest.clearAllMocks();
    (systemPrisma.tenant.findMany as jest.Mock).mockResolvedValue([tenant]);
    (prisma.documentBrandAsset.findMany as jest.Mock)
      .mockResolvedValueOnce([{ id: 'asset-1', tenant_id: 'tenant-1' }])
      .mockResolvedValueOnce([])
      .mockResolvedValue([]);
    service = new DocumentBrandingUploadRecoveryService(
      prisma,
      systemPrisma,
      requestContext,
      storage,
      tasks,
    );
  });

  it('runs recoverAndClean without ambient tenant context', async () => {
    expect(TenantContextStorage.getUser()).toBeUndefined();
    (systemPrisma.tenant.findMany as jest.Mock).mockResolvedValue([
      { id: 'tenant-1' },
      { id: 'tenant-2' },
    ]);
    const tenantIdsAtQuotaDelete: Array<string | undefined> = [];
    const tenantIdsAtAssetUpdate: Array<string | undefined> = [];
    const tenantIdsAtAssetFind: Array<string | undefined> = [];
    (prisma.documentBrandQuotaEvent.deleteMany as jest.Mock).mockReset();
    (prisma.documentBrandAsset.updateMany as jest.Mock).mockReset();
    (prisma.documentBrandAsset.findMany as jest.Mock).mockReset();
    (prisma.documentBrandQuotaEvent.deleteMany as jest.Mock).mockImplementation(
      () => {
        tenantIdsAtQuotaDelete.push(TenantContextStorage.getUser()?.tenantId);
        return Promise.resolve({ count: 0 });
      },
    );
    (prisma.documentBrandAsset.updateMany as jest.Mock).mockImplementation(
      () => {
        tenantIdsAtAssetUpdate.push(TenantContextStorage.getUser()?.tenantId);
        return Promise.resolve({ count: 0 });
      },
    );
    (prisma.documentBrandAsset.findMany as jest.Mock).mockImplementation(() => {
      tenantIdsAtAssetFind.push(TenantContextStorage.getUser()?.tenantId);
      return Promise.resolve([]);
    });

    await expect(service.recoverAndClean()).resolves.toBeUndefined();

    const perTenant = (ids: Array<string | undefined>) =>
      expect(ids).toEqual(['tenant-1', 'tenant-2']);
    perTenant(tenantIdsAtQuotaDelete);
    perTenant(tenantIdsAtAssetUpdate);
    expect(tenantIdsAtAssetFind).toEqual([
      'tenant-1',
      'tenant-1',
      'tenant-1',
      'tenant-2',
      'tenant-2',
      'tenant-2',
    ]);
    expect(TenantContextStorage.getUser()).toBeUndefined();
  });

  it('requeues only tenant-scoped quarantined assets and exhausts stale third attempts', async () => {
    await service.recoverAndClean();
    const query = (prisma.documentBrandAsset.findMany as jest.Mock).mock
      .calls[0][0];
    expect(query.where).toMatchObject({
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
      bucket: 'private-branding',
      object_key: 'tenants/tenant-1/legal-entities/entity-1/document-branding/assets/asset-1.pdf',
      object_generation: '456',
      quarantine_bucket: 'private-branding',
      quarantine_object_key: 'quarantine/asset-1',
      quarantine_object_generation: '123',
      preview_bucket: 'private-branding',
      preview_object_key:
        'tenants/tenant-1/legal-entities/entity-1/document-branding/assets/asset-1-page1.png',
      preview_object_generation: '789',
    };
    const txAssetFindFirst = jest.fn(({ where }) => {
      if (where.source_asset_id) return Promise.resolve(null);
      if (where.state === 'DELETING') {
        return Promise.resolve({ ...current, state: 'DELETING' });
      }
      return Promise.resolve(current);
    });
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
        invoiceBrandAssetReference: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      documentBrandExtraction: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
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
      'tenants/tenant-1/legal-entities/entity-1/document-branding/assets/asset-1.pdf',
      '456',
    );
    expect(storage.deleteGeneration).toHaveBeenCalledWith(
      'private-branding',
      'tenants/tenant-1/legal-entities/entity-1/document-branding/assets/asset-1-page1.png',
      '789',
    );
    expect(storage.deleteGeneration).toHaveBeenCalledWith(
      'private-branding',
      'quarantine/asset-1',
      '123',
    );
    expect(prisma.documentBrandAsset.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: 'DELETED',
          preview_object_key: null,
        }),
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
        invoiceBrandAssetReference: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        documentBrandExtraction: {
          findFirst: jest.fn().mockResolvedValue(null),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      }),
    );
    await service.recoverAndClean();
    expect(storage.deleteGeneration).not.toHaveBeenCalled();
  });

  it('terminalizes source-backed jobs and clears their source reference at source expiry', async () => {
    (prisma.documentBrandAsset.findMany as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'source-1', tenant_id: 'tenant-1', legal_entity_id: 'entity-1' },
      ])
      .mockResolvedValue([]);
    const extractionUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const assetUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
    const asset = {
      id: 'source-1',
      tenant_id: 'tenant-1',
      legal_entity_id: 'entity-1',
      purpose: 'SOURCE',
      state: 'READY',
      expires_at: new Date(Date.now() - 1_000),
      bucket: 'private-branding',
      object_key: 'source/1.png',
      object_generation: '10',
      quarantine_bucket: null,
      quarantine_object_key: null,
      quarantine_object_generation: null,
    };
    const txAssetFindFirst = jest.fn(({ where }) =>
      Promise.resolve(where.state === 'DELETING' ? { ...asset, state: 'DELETING' } : asset),
    );
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback) =>
      callback({
        legalEntity: {
          findFirst: jest.fn().mockResolvedValue({ id: 'entity-1', is_active: true }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        documentBrandAsset: {
          findFirst: txAssetFindFirst,
          updateMany: assetUpdateMany,
        },
        documentBrandProfile: { findFirst: jest.fn().mockResolvedValue(null) },
        invoiceBrandAssetReference: { findFirst: jest.fn().mockResolvedValue(null) },
        documentBrandExtraction: {
          findFirst: jest.fn().mockResolvedValue(null),
          updateMany: extractionUpdateMany,
        },
      }),
    );

    await service.recoverAndClean();

    expect(extractionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ state: { in: ['QUEUED', 'RUNNING'] } }),
        data: expect.objectContaining({ state: 'FAILED', failure_code: 'BRAND_SOURCE_EXPIRED' }),
      }),
    );
    expect(extractionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { source_asset_id: null } }),
    );
    expect(assetUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { source_asset_id: null } }),
    );
  });

  it.each([
    {
      state: 'REJECTED',
      description: 'transitioning an expired asset to DELETING',
    },
    {
      state: 'DELETING',
      description: 'deleting an already-DELETING asset on retry',
    },
  ])(
    'committed invoice reference prevents cleanup from $description',
    async ({ state }) => {
      (prisma.documentBrandAsset.findMany as jest.Mock)
        .mockReset()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'asset-1',
            tenant_id: 'tenant-1',
            legal_entity_id: 'entity-1',
          },
        ])
        .mockResolvedValueOnce([]);
      const current = {
        id: 'asset-1',
        tenant_id: 'tenant-1',
        legal_entity_id: 'entity-1',
        state,
        expires_at: new Date(Date.now() - 1_000),
        bucket: 'branding',
        object_key: 'logo/asset-1.png',
        object_generation: '9',
        quarantine_bucket: null,
        quarantine_object_key: null,
        quarantine_object_generation: null,
      };
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      (prisma.$transaction as jest.Mock).mockImplementation(async (callback) =>
        callback({
          legalEntity: {
            findFirst: jest
              .fn()
              .mockResolvedValue({ id: 'entity-1', is_active: true }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          documentBrandAsset: {
            findFirst: jest
              .fn()
              .mockResolvedValueOnce(current)
              .mockResolvedValueOnce(null),
            updateMany,
          },
          documentBrandProfile: { findFirst: jest.fn().mockResolvedValue(null) },
          invoiceBrandAssetReference: {
            findFirst: jest.fn().mockResolvedValue({ id: 'reference-1' }),
          },
          documentBrandExtraction: {
            findFirst: jest.fn().mockResolvedValue(null),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
        }),
      );

      await service.recoverAndClean();

      expect(updateMany).not.toHaveBeenCalled();
      expect(storage.deleteGeneration).not.toHaveBeenCalled();
    },
  );

  it('rechecks committed invoice references under the entity lock before generation deletion', async () => {
    (prisma.documentBrandAsset.findMany as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'asset-1',
          tenant_id: 'tenant-1',
          legal_entity_id: 'entity-1',
        },
      ])
      .mockResolvedValueOnce([]);
    const current = {
      id: 'asset-1',
      tenant_id: 'tenant-1',
      legal_entity_id: 'entity-1',
      state: 'REJECTED',
      expires_at: new Date(Date.now() - 1_000),
      bucket: 'branding',
      object_key: 'logo/asset-1.png',
      object_generation: '9',
      quarantine_bucket: null,
      quarantine_object_key: null,
      quarantine_object_generation: null,
    };
    const invoiceReferenceFindFirst = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'reference-created-after-transition' });
    const lockOrder: string[] = [];
    const markDeleting = jest.fn().mockImplementation(async () => {
      lockOrder.push('mark-deleting');
      current.state = 'DELETING';
      return { count: 1 };
    });
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback) =>
      callback({
        legalEntity: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 'entity-1', is_active: true }),
          updateMany: jest.fn().mockImplementation(async () => {
            lockOrder.push('entity-lock');
            return { count: 1 };
          }),
        },
        documentBrandAsset: {
          findFirst: jest.fn(({ where }) => {
            lockOrder.push('asset-read');
            if (where.source_asset_id) return Promise.resolve(null);
            if (where.state === 'DELETING') {
              return Promise.resolve({ ...current, state: 'DELETING' });
            }
            return Promise.resolve(current);
          }),
          updateMany: markDeleting,
        },
        documentBrandProfile: { findFirst: jest.fn().mockResolvedValue(null) },
        invoiceBrandAssetReference: {
          findFirst: jest.fn(async (...args) => {
            lockOrder.push('invoice-reference-check');
            return invoiceReferenceFindFirst(...args);
          }),
        },
        documentBrandExtraction: {
          findFirst: jest.fn().mockResolvedValue(null),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      }),
    );

    await service.recoverAndClean();

    expect(invoiceReferenceFindFirst).toHaveBeenCalledTimes(2);
    expect(storage.deleteGeneration).not.toHaveBeenCalled();
    expect(lockOrder).toEqual([
      'entity-lock',
      'asset-read',
      'asset-read',
      'invoice-reference-check',
      'mark-deleting',
      'entity-lock',
      'asset-read',
      'asset-read',
      'invoice-reference-check',
    ]);
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
