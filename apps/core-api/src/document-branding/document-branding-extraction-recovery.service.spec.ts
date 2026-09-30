import { RequestContextService } from '../common/services/request-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { DocumentBrandingExtractionTaskService } from './document-branding-extraction-task.service.js';
import { DocumentBrandingExtractionRecoveryService } from './document-branding-extraction-recovery.service.js';

describe('DocumentBrandingExtractionRecoveryService', () => {
  const systemPrisma = {
    tenant: { findMany: jest.fn().mockResolvedValue([{ id: 'tenant-1' }]) },
  } as unknown as SystemPrismaService;
  const requestContext = new RequestContextService();
  const prisma = {
    documentBrandExtraction: {
      findMany: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn(),
  } as unknown as PrismaService;
  const transaction = {
    legalEntity: {
      findFirst: jest.fn().mockResolvedValue({ id: 'entity-1', is_active: true }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    documentBrandExtraction: {
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    documentBrandProfile: { findFirst: jest.fn().mockResolvedValue(null) },
    invoiceBrandAssetReference: { findFirst: jest.fn().mockResolvedValue(null) },
    documentBrandAsset: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const tasks = { enqueue: jest.fn().mockResolvedValue(undefined) } as unknown as DocumentBrandingExtractionTaskService;
  let service: DocumentBrandingExtractionRecoveryService;

  beforeEach(() => {
    jest.clearAllMocks();
    (systemPrisma.tenant.findMany as jest.Mock).mockResolvedValue([
      { id: 'tenant-1' },
    ]);
    (prisma.documentBrandExtraction.findMany as jest.Mock)
      .mockResolvedValueOnce([
        {
          id: 'job-1',
          tenant_id: 'tenant-1',
          legal_entity_id: 'entity-1',
          attempt_count: 0,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    (prisma.documentBrandExtraction.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.$transaction as jest.Mock).mockImplementation((callback) => callback(transaction));
    transaction.documentBrandExtraction.updateMany.mockResolvedValue({ count: 1 });
    transaction.documentBrandAsset.updateMany.mockResolvedValue({ count: 1 });
    service = new DocumentBrandingExtractionRecoveryService(
      prisma,
      systemPrisma,
      requestContext,
      tasks,
    );
  });

  it('runs recover without ambient tenant context', async () => {
    await expect(service.recover()).resolves.toBeUndefined();
    expect(systemPrisma.tenant.findMany).toHaveBeenCalled();
  });

  it('requeues stale queued jobs with their tenant and entity bindings', async () => {
    await service.recover();

    expect(tasks.enqueue).toHaveBeenCalledWith({
      extractionId: 'job-1',
      legalEntityId: 'entity-1',
      tenantId: 'tenant-1',
      expectedAttemptCount: 0,
    });
    expect(prisma.documentBrandExtraction.updateMany).not.toHaveBeenCalled();
  });

  it('marks expired third-attempt leases failed without requeueing', async () => {
    (prisma.documentBrandExtraction.findMany as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'job-3',
          tenant_id: 'tenant-1',
          legal_entity_id: 'entity-1',
          attempt_count: 3,
          lease_token: 'lease-3',
        },
      ])
      .mockResolvedValueOnce([]);

    await service.recover();

    expect(prisma.documentBrandExtraction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ state: 'RUNNING', lease_token: 'lease-3' }),
        data: expect.objectContaining({
          state: 'FAILED',
          failure_code: 'BRAND_EXTRACTION_RETRIES_EXHAUSTED',
        }),
      }),
    );
    expect(tasks.enqueue).not.toHaveBeenCalled();
  });

  it('starts the derived logo grace period when an expired proposal releases its last reference', async () => {
    (prisma.documentBrandExtraction.findMany as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'job-expired',
          tenant_id: 'tenant-1',
          legal_entity_id: 'entity-1',
          proposal_logo_asset_id: 'derived-logo-1',
        },
      ]);

    await service.recover();

    expect(transaction.documentBrandExtraction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { proposal: expect.anything(), proposal_logo_asset_id: null },
      }),
    );
    const graceUpdate = transaction.documentBrandAsset.updateMany.mock.calls[0][0];
    expect(graceUpdate.where).toMatchObject({
      id: 'derived-logo-1',
      tenant_id: 'tenant-1',
      legal_entity_id: 'entity-1',
      purpose: 'LOGO',
    });
    expect(graceUpdate.data.expires_at.getTime()).toBeGreaterThan(
      Date.now() + 6 * 24 * 60 * 60 * 1000,
    );
  });
});
