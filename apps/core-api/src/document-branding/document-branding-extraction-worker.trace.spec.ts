import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { DocumentBrandingAssetStorage } from './document-branding-asset-storage.js';
import type { DocumentBrandingPdfParser } from './document-branding-pdf-parser.js';
import type { DocumentBrandingExtractionImageProcessor } from './document-branding-extraction-image-processor.js';
import type { DocumentBrandingExtractionProvider } from './document-branding-extraction-provider.js';
import type { DocumentBrandingExtractionTaskService } from './document-branding-extraction-task.service.js';

// Fakes implement only the members these tests call; this is the one cast.
function asFake<T>(double: Partial<T>): T {
  return double as T;
}

type FakeSpan = {
  name: string;
  op: string;
  attributes: Record<string, unknown>;
  setAttribute: jest.Mock;
  setAttributes: jest.Mock;
};

function asyncMock() {
  return jest.fn<(args: unknown) => Promise<unknown>>();
}

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
  let storage: Record<string, ReturnType<typeof asyncMock>>;
  let processor: Record<string, ReturnType<typeof asyncMock>>;
  let provider: {
    isAvailable: jest.Mock<() => boolean>;
    getMetadata: jest.Mock<() => { providerId: string; modelId: string }>;
    extract: ReturnType<typeof asyncMock>;
  };
  let tasks: {
    enqueue: jest.Mock<DocumentBrandingExtractionTaskService['enqueue']>;
  };
  let service: InstanceType<typeof DocumentBrandingExtractionWorkerService>;

  beforeEach(() => {
    recordedSpans.length = 0;
    transaction = {
      documentBrandExtraction: {
        updateMany: asyncMock().mockResolvedValue({ count: 1 }),
      },
      legalEntity: {
        findFirst: asyncMock().mockResolvedValue({ id: 'entity-1' }),
        updateMany: asyncMock().mockResolvedValue({ count: 1 }),
      },
      documentBrandAsset: {
        findFirst: asyncMock().mockResolvedValue({ id: 'source-1' }),
        create: asyncMock().mockResolvedValue({}),
      },
    };
    prisma = {
      documentBrandExtraction: {
        updateMany: asyncMock().mockResolvedValue({ count: 1 }),
        findFirst: asyncMock()
          .mockResolvedValueOnce({ attempt_count: 1 })
          .mockResolvedValueOnce(extraction),
      },
      tenantMember: {
        findFirst: asyncMock().mockResolvedValue({ id: 'membership-1' }),
      },
      legalEntity: {
        findFirst: asyncMock().mockResolvedValue({ id: 'entity-1' }),
      },
      documentBrandAsset: { findFirst: asyncMock().mockResolvedValue(source) },
      $transaction: jest.fn<(callback: (tx: unknown) => unknown) => unknown>(
        (callback) => callback(transaction),
      ),
    };
    storage = {
      readGeneration: asyncMock().mockResolvedValue(sourceBytes),
      storeImmutable: asyncMock().mockResolvedValue({
        bucket: 'private-branding',
        generation: '9',
      }),
      deleteGeneration: asyncMock().mockResolvedValue(undefined),
    };
    processor = {
      normalizePng: asyncMock().mockResolvedValue({
        bytes: sourceBytes,
        width: 2,
        height: 2,
      }),
      cropLogo: asyncMock().mockResolvedValue({
        bytes: sourceBytes,
        width: 2,
        height: 2,
      }),
    };
    provider = {
      isAvailable: jest.fn<() => boolean>().mockReturnValue(true),
      getMetadata: jest
        .fn<() => { providerId: string; modelId: string }>()
        .mockReturnValue({
          providerId: 'mock-provider',
          modelId: 'mock-model',
        }),
      extract: asyncMock().mockResolvedValue(response),
    };
    tasks = {
      enqueue: jest
        .fn<DocumentBrandingExtractionTaskService['enqueue']>()
        .mockResolvedValue({ taskId: 'task-1' }),
    };
    service = new DocumentBrandingExtractionWorkerService(
      prisma as unknown as PrismaService,
      storage as unknown as DocumentBrandingAssetStorage,
      {} as DocumentBrandingPdfParser,
      processor as unknown as DocumentBrandingExtractionImageProcessor,
      provider,
      asFake<DocumentBrandingExtractionTaskService>(tasks),
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
