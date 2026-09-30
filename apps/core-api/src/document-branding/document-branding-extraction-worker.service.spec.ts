import { HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { DocumentBrandingAssetStorage } from './document-branding-asset-storage.js';
import { DocumentBrandingPdfParser } from './document-branding-pdf-parser.js';
import { DocumentBrandingExtractionImageProcessor } from './document-branding-extraction-image-processor.js';
import type { DocumentBrandingExtractionProvider } from './document-branding-extraction-provider.js';
import { DocumentBrandingExtractionTaskService } from './document-branding-extraction-task.service.js';
import { DocumentBrandingExtractionWorkerService } from './document-branding-extraction-worker.service.js';

describe('DocumentBrandingExtractionWorkerService', () => {
  const sourceBytes = Buffer.from('normalized-png');
  const extraction = {
    id: 'extraction-1',
    tenant_id: 'tenant-1',
    legal_entity_id: 'entity-1',
    source_asset_id: 'source-1',
    requested_by_user_id: 'user-1',
    attempt_count: 1,
    createdAt: new Date(),
  };
  const source = {
    id: 'source-1',
    bucket: 'private-branding',
    object_key: 'source/letterhead.png',
    object_generation: '7',
    detected_mime_type: 'image/png',
  };
  const response = {
    confidence: 'SUFFICIENT',
    theme: {
      schemaVersion: 1,
      presetId: 'standard-v1',
      primaryColor: '#123456',
      secondaryColor: '#E5E7EB',
      fontId: 'acp-sans-v1',
      headerBand: 'none',
      footerBand: 'none',
      headerText: 'Auto Core',
      footerText: '',
    },
    warningCodes: [],
    cropRect: null,
  };

  let prisma: Record<string, any>;
  let transaction: Record<string, any>;
  let storage: Record<string, jest.Mock>;
  let processor: Record<string, jest.Mock>;
  let provider: Record<string, jest.Mock>;
  let tasks: { enqueue: jest.Mock };
  let service: DocumentBrandingExtractionWorkerService;

  beforeEach(() => {
    transaction = {
      documentBrandExtraction: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      legalEntity: {
        findFirst: jest.fn().mockResolvedValue({ id: 'entity-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      documentBrandAsset: {
        findFirst: jest.fn().mockResolvedValue({ id: 'source-1' }),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    prisma = {
      documentBrandExtraction: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ attempt_count: 1 })
          .mockResolvedValueOnce(extraction),
      },
      tenantMember: {
        findFirst: jest.fn().mockResolvedValue({ id: 'membership-1' }),
      },
      legalEntity: { findFirst: jest.fn().mockResolvedValue({ id: 'entity-1' }) },
      documentBrandAsset: { findFirst: jest.fn().mockResolvedValue(source) },
      $transaction: jest.fn((callback) => callback(transaction)),
    };
    storage = {
      readGeneration: jest.fn().mockResolvedValue(sourceBytes),
      storeImmutable: jest
        .fn()
        .mockResolvedValue({ bucket: 'private-branding', generation: '9' }),
      deleteGeneration: jest.fn().mockResolvedValue(undefined),
    };
    processor = {
      normalizePng: jest
        .fn()
        .mockResolvedValue({ bytes: sourceBytes, width: 2, height: 2 }),
      cropLogo: jest
        .fn()
        .mockResolvedValue({ bytes: sourceBytes, width: 2, height: 2 }),
    };
    provider = {
      isAvailable: jest.fn().mockReturnValue(true),
      getMetadata: jest.fn().mockReturnValue({
        providerId: 'mock-provider',
        modelId: 'mock-model',
      }),
      extract: jest.fn().mockResolvedValue(response),
    };
    tasks = { enqueue: jest.fn().mockResolvedValue(undefined) };
    service = new DocumentBrandingExtractionWorkerService(
      prisma as unknown as PrismaService,
      storage as unknown as DocumentBrandingAssetStorage,
      {} as DocumentBrandingPdfParser,
      processor as unknown as DocumentBrandingExtractionImageProcessor,
      provider as unknown as DocumentBrandingExtractionProvider,
      tasks as unknown as DocumentBrandingExtractionTaskService,
    );
  });

  it('publishes a validated proposal and derived logo under the claimed lease', async () => {
    await service.process('extraction-1', 'entity-1', 'tenant-1', 0);

    expect(transaction.documentBrandAsset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenant_id: 'tenant-1',
          legal_entity_id: 'entity-1',
          purpose: 'LOGO',
          state: 'READY',
          expires_at: null,
        }),
      }),
    );
    expect(transaction.documentBrandExtraction.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: 'SUCCEEDED',
          provider_id: 'mock-provider',
          model_id: 'mock-model',
        }),
      }),
    );
  });

  it('fails a requester-revoked job without publishing a proposal', async () => {
    prisma.tenantMember.findFirst.mockResolvedValue(null);

    await service.process('extraction-1', 'entity-1', 'tenant-1', 0);

    expect(prisma.documentBrandExtraction.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: 'FAILED',
          failure_code: 'BRAND_REQUESTER_REVOKED',
        }),
      }),
    );
    expect(transaction.documentBrandAsset.create).not.toHaveBeenCalled();
  });

  it('fails instead of leaving a running job when the entity deactivates before publish', async () => {
    transaction.legalEntity.findFirst.mockResolvedValue(null);

    await service.process('extraction-1', 'entity-1', 'tenant-1', 0);

    expect(prisma.documentBrandExtraction.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: 'FAILED',
          failure_code: 'LEGAL_ENTITY_INACTIVE',
        }),
      }),
    );
    expect(transaction.documentBrandAsset.create).not.toHaveBeenCalled();
  });

  it('fails instead of leaving a running job when its source expires before publish', async () => {
    transaction.documentBrandAsset.findFirst.mockResolvedValue(null);

    await service.process('extraction-1', 'entity-1', 'tenant-1', 0);

    expect(prisma.documentBrandExtraction.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: 'FAILED',
          failure_code: 'BRAND_SOURCE_EXPIRED',
        }),
      }),
    );
    expect(transaction.documentBrandAsset.create).not.toHaveBeenCalled();
  });

  it('does not publish a late result after the extraction was discarded', async () => {
    transaction.documentBrandExtraction.updateMany.mockResolvedValueOnce({
      count: 0,
    });

    await service.process('extraction-1', 'entity-1', 'tenant-1', 0);

    expect(transaction.documentBrandAsset.create).not.toHaveBeenCalled();
    expect(storage.deleteGeneration).toHaveBeenCalledWith(
      'private-branding',
      expect.stringContaining('/assets/'),
      '9',
    );
  });

  it('ignores duplicate task delivery when another worker owns the lease', async () => {
    prisma.documentBrandExtraction.updateMany.mockResolvedValueOnce({
      count: 0,
    });

    await service.process('extraction-1', 'entity-1', 'tenant-1', 0);

    expect(storage.readGeneration).not.toHaveBeenCalled();
    expect(provider.extract).not.toHaveBeenCalled();
  });

  it('requeues provider rate limits when retry budget remains', async () => {
    provider.extract.mockRejectedValue(
      new HttpException(
        {
          code: 'BRAND_EXTRACTION_PROVIDER_RATE_LIMIT',
          message: 'The letterhead extraction provider is rate limited.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      ),
    );

    await service.process('extraction-1', 'entity-1', 'tenant-1', 0);

    expect(prisma.documentBrandExtraction.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: 'QUEUED',
          failure_code: null,
        }),
      }),
    );
    expect(tasks.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        extractionId: 'extraction-1',
        delaySeconds: 5,
      }),
    );
  });

  it('records provider rate limit failure after retry budget is exhausted', async () => {
    prisma.documentBrandExtraction.findFirst
      .mockReset()
      .mockResolvedValueOnce({ attempt_count: 3 })
      .mockResolvedValueOnce(extraction);
    provider.extract.mockRejectedValue(
      new HttpException(
        {
          code: 'BRAND_EXTRACTION_PROVIDER_RATE_LIMIT',
          message: 'The letterhead extraction provider is rate limited.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      ),
    );

    await service.process('extraction-1', 'entity-1', 'tenant-1', 2);

    expect(prisma.documentBrandExtraction.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: 'FAILED',
          failure_code: 'BRAND_EXTRACTION_PROVIDER_RATE_LIMIT',
        }),
      }),
    );
    expect(tasks.enqueue).not.toHaveBeenCalled();
  });

  it('does not claim a stale task generation after the extraction attempt advances', async () => {
    await service.process('extraction-1', 'entity-1', 'tenant-1', 0);

    expect(prisma.documentBrandExtraction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ attempt_count: 0 }),
      }),
    );
  });
});
