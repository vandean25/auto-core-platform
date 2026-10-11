import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { DocumentBrandingAssetStorage } from './document-branding-asset-storage.js';
import type { DocumentBrandingPdfParser } from './document-branding-pdf-parser.js';
import type { DocumentBrandingExtractionImageProcessor } from './document-branding-extraction-image-processor.js';
import type { DocumentBrandingExtractionProvider } from './document-branding-extraction-provider.js';
import type { DocumentBrandingExtractionTaskService } from './document-branding-extraction-task.service.js';

type FakeSpan = {
  name: string;
  op: string;
  attributes: Record<string, unknown>;
  setAttribute: jest.Mock;
  setAttributes: jest.Mock;
};

// Each startSpan call is recorded, so the branding.extract tree can be read back by op.
const recordedSpans: FakeSpan[] = [];

jest.unstable_mockModule('@sentry/node', () => ({
  getClient: () => ({}),
  startSpan: (
    options: {
      name: string;
      op: string;
      attributes?: Record<string, unknown>;
    },
    callback: (span: FakeSpan) => unknown,
  ) => {
    const span: FakeSpan = {
      name: options.name,
      op: options.op,
      attributes: { ...options.attributes },
      setAttribute: jest.fn(),
      setAttributes: jest.fn(),
    };
    recordedSpans.push(span);
    return callback(span);
  },
  getActiveSpan: () => undefined,
  getCurrentScope: jest.fn(),
  getIsolationScope: jest.fn(),
  getTraceData: jest.fn(),
}));

const { DocumentBrandingExtractionWorkerService } = await import(
  './document-branding-extraction-worker.service.js'
);

const spanByOp = (op: string) => recordedSpans.find((span) => span.op === op);

describe('DocumentBrandingExtractionWorkerService spans', () => {
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

  let transaction: Record<string, any>;
  let prisma: Record<string, any>;
  let storage: Record<string, jest.Mock>;
  let processor: Record<string, jest.Mock>;
  let provider: Record<string, jest.Mock>;
  let tasks: { enqueue: jest.Mock };
  let service: InstanceType<typeof DocumentBrandingExtractionWorkerService>;

  beforeEach(() => {
    recordedSpans.length = 0;
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
      legalEntity: {
        findFirst: jest.fn().mockResolvedValue({ id: 'entity-1' }),
      },
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

  it('records branding.extract, parse and provider spans for a published attempt', async () => {
    await service.process('extraction-1', 'entity-1', 'tenant-1', 0);

    const root = spanByOp('branding.extract');
    expect(root?.name).toBe('Extract document branding');
    expect(root?.attributes).toEqual({
      provider: 'mock-provider',
      model_id: 'mock-model',
    });
    expect(root?.setAttribute).toHaveBeenCalledWith('asset_id', 'source-1');
    expect(root?.setAttribute).toHaveBeenCalledWith(
      'byte_size_bucket',
      'lt_100kb',
    );
    expect(root?.setAttribute).toHaveBeenCalledWith('status', 'published');
    expect(root?.setAttribute).toHaveBeenCalledWith(
      'duration_ms',
      expect.any(Number),
    );
    expect(spanByOp('branding.extract.parse')?.attributes).toEqual({
      source_kind: 'image',
      byte_size_bucket: 'lt_100kb',
    });
    expect(spanByOp('branding.extract.parse')?.setAttribute).toHaveBeenCalledWith(
      'status',
      'ok',
    );
    expect(spanByOp('branding.extract.provider')?.attributes).toEqual({
      provider: 'mock-provider',
      model_id: 'mock-model',
    });
    expect(spanByOp('branding.extract.provider')?.setAttribute).toHaveBeenCalledWith(
      'status',
      'ok',
    );
  });

  it('keeps extracted branding text and provider replies out of every span', async () => {
    await service.process('extraction-1', 'entity-1', 'tenant-1', 0);

    const recorded = JSON.stringify(
      recordedSpans.map((span) => [
        span.attributes,
        span.setAttribute.mock.calls,
        span.setAttributes.mock.calls,
      ]),
    );
    expect(recorded).not.toContain('Auto Core');
    expect(recorded).not.toContain('#123456');
    expect(recorded).not.toContain('normalized-png');
  });

  it('marks a rejected provider call as failed and records only the BRAND code', async () => {
    provider.extract.mockRejectedValueOnce(
      new HttpException(
        {
          code: 'BRAND_PROVIDER_REJECTED',
          message: 'Provider rejected the image contents',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      ),
    );

    await service.process('extraction-1', 'entity-1', 'tenant-1', 0);

    expect(spanByOp('branding.extract')?.setAttributes).toHaveBeenCalledWith({
      status: 'failed',
      failure_code: 'BRAND_PROVIDER_REJECTED',
    });
    expect(spanByOp('branding.extract.provider')?.setAttribute).toHaveBeenCalledWith(
      'status',
      'failed',
    );
    const recorded = JSON.stringify(
      recordedSpans.map((span) => [
        span.attributes,
        span.setAttribute.mock.calls,
        span.setAttributes.mock.calls,
      ]),
    );
    expect(recorded).not.toContain('Provider rejected the image contents');
  });
});
