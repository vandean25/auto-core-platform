import { ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { DocumentBrandingExtractionProvider } from './document-branding-extraction-provider.js';
import { DocumentBrandingExtractionService } from './document-branding-extraction.service.js';

describe('DocumentBrandingExtractionService', () => {
  const provider: DocumentBrandingExtractionProvider & {
    isAvailable: jest.Mock;
    getMetadata: jest.Mock;
    extract: jest.Mock;
  } = {
    isAvailable: jest.fn().mockReturnValue(false),
    getMetadata: jest.fn().mockReturnValue({ providerId: 'disabled', modelId: 'none' }),
    extract: jest.fn(),
  };
  const prisma = {
    legalEntity: {
      findFirst: jest.fn().mockResolvedValue({ id: 'entity-1', is_active: true }),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1' }) },
    tenantMember: {
      findFirst: jest.fn().mockResolvedValue({ id: 'membership-1' }),
    },
    documentBrandAsset: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'source-1',
        state: 'READY',
        expires_at: new Date(Date.now() + 60_000),
      }),
    },
    documentBrandExtraction: { findFirst: jest.fn() },
  } as unknown as PrismaService;
  const tenantContext = {
    getTenantId: jest.fn().mockResolvedValue('tenant-1'),
    getAuthenticatedUser: jest
      .fn()
      .mockReturnValue({ role: 'OWNER', userId: 'firebase-user-1' }),
  } as unknown as TenantContextService;

  let service: DocumentBrandingExtractionService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(provider.isAvailable).mockReturnValue(false);
    service = new DocumentBrandingExtractionService(
      prisma,
      tenantContext,
      provider,
    );
  });

  it('rejects creation with the unavailable contract when no provider is approved', async () => {
    await expect(
      service.create(
        'entity-1',
        { sourceAssetId: 'source-1', expectedRevision: 0 },
        'aut324-disabled',
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(provider.extract).not.toHaveBeenCalled();
  });

  it('leaves dispatch markers empty until the queued extraction is enqueued', async () => {
    jest.mocked(provider.isAvailable).mockReturnValue(true);
    const queuedExtraction = {
      id: 'extraction-1',
      state: 'QUEUED',
      attempt_count: 0,
      proposal: null,
      warning_codes: [],
      base_revision: 0,
      createdAt: new Date(),
      completed_at: null,
      expires_at: null,
      failure_code: null,
    };
    const createExtraction = jest.fn().mockResolvedValue(queuedExtraction);
    const transaction = {
      legalEntity: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      documentBrandAsset: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'source-1',
          state: 'READY',
          expires_at: new Date(Date.now() + 60_000),
        }),
      },
      documentBrandExtraction: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: createExtraction,
      },
      documentBrandProfile: {
        findFirst: jest.fn().mockResolvedValue({ revision: 0 }),
      },
      documentBrandQuotaLock: { upsert: jest.fn() },
      documentBrandQuotaEvent: {
        deleteMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
      },
    };
    const prismaWithTransaction = prisma as unknown as {
      $transaction: jest.Mock;
    };
    prismaWithTransaction.$transaction = jest.fn((callback) =>
      callback(transaction),
    );
    const tasks = { enqueue: jest.fn().mockRejectedValue(new Error('offline')) };
    service = new DocumentBrandingExtractionService(
      prisma,
      tenantContext,
      provider,
      tasks as never,
    );

    await service.create(
      'entity-1',
      { sourceAssetId: 'source-1', expectedRevision: 0 },
      'aut324-dispatch-state',
    );

    expect(createExtraction).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dispatched_at: null,
        dispatch_count: 0,
      }),
    });
    expect(tasks.enqueue).toHaveBeenCalledWith({
      extractionId: 'extraction-1',
      legalEntityId: 'entity-1',
      tenantId: 'tenant-1',
      expectedAttemptCount: 0,
    });
  });

  it('recovers an idempotency collision and enqueues the recovered queued row', async () => {
    const dto = { sourceAssetId: 'source-1', expectedRevision: 0 };
    const extraction = makeExtraction({
      id: 'existing-extraction',
      state: 'QUEUED',
      request_hash: createHash('sha256').update(JSON.stringify(dto)).digest('hex'),
    });
    const uniqueError = makeUniqueConstraintError(
      'document_brand_extractions_idempotency_key',
    );
    const transaction = jest.fn().mockRejectedValue(uniqueError);
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = transaction;
    jest.mocked(prisma.documentBrandExtraction.findFirst).mockResolvedValueOnce(
      extraction,
    );
    jest.mocked(provider.isAvailable).mockReturnValue(true);
    const tasks = { enqueue: jest.fn().mockResolvedValue(undefined) };
    service = new DocumentBrandingExtractionService(
      prisma,
      tenantContext,
      provider,
      tasks as never,
    );

    const result = await service.create('entity-1', dto, 'same-key');

    expect(prisma.documentBrandExtraction.findFirst).toHaveBeenCalledWith({
      where: {
        tenant_id: 'tenant-1',
        legal_entity_id: 'entity-1',
        idempotency_key: 'same-key',
      },
    });
    expect(tasks.enqueue).toHaveBeenCalledWith({
      extractionId: 'existing-extraction',
      legalEntityId: 'entity-1',
      tenantId: 'tenant-1',
      expectedAttemptCount: 0,
    });
    expect(result.id).toBe('existing-extraction');
  });

  it('rejects an idempotency collision when the existing request hash differs', async () => {
    const uniqueError = makeUniqueConstraintError(
      'document_brand_extractions_idempotency_key',
    );
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest
      .fn()
      .mockRejectedValue(uniqueError);
    jest.mocked(prisma.documentBrandExtraction.findFirst).mockResolvedValueOnce(
      makeExtraction({ request_hash: 'different-request-hash' }),
    );
    jest.mocked(provider.isAvailable).mockReturnValue(true);

    await expect(
      service.create(
        'entity-1',
        { sourceAssetId: 'source-1', expectedRevision: 0 },
        'same-key',
      ),
    ).rejects.toMatchObject({
      response: { code: 'BRAND_IDEMPOTENCY_CONFLICT' },
    });
  });

  it('maps the active extraction unique index collision to busy', async () => {
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest
      .fn()
      .mockRejectedValue(
        makeUniqueConstraintError('document_brand_extractions_one_active_per_entity'),
      );
    jest.mocked(provider.isAvailable).mockReturnValue(true);

    await expect(
      service.create(
        'entity-1',
        { sourceAssetId: 'source-1', expectedRevision: 0 },
        'new-key',
      ),
    ).rejects.toMatchObject({
      response: { code: 'BRAND_EXTRACTION_BUSY' },
    });
  });

  it('rethrows an unrelated unique index error unchanged', async () => {
    const unrelatedError = makeUniqueConstraintError('unrelated_unique_index');
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest
      .fn()
      .mockRejectedValue(unrelatedError);
    jest.mocked(provider.isAvailable).mockReturnValue(true);

    await expect(
      service.create(
        'entity-1',
        { sourceAssetId: 'source-1', expectedRevision: 0 },
        'new-key',
      ),
    ).rejects.toBe(unrelatedError);
  });

  it.each(['RUNNING', 'SUCCEEDED'])(
    'does not enqueue a recovered %s extraction',
    async (state) => {
    const dto = { sourceAssetId: 'source-1', expectedRevision: 0 };
    const extraction = makeExtraction({
      state,
      request_hash: createHash('sha256').update(JSON.stringify(dto)).digest('hex'),
    });
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest
      .fn()
      .mockRejectedValue(
        makeUniqueConstraintError('document_brand_extractions_idempotency_key'),
      );
    jest.mocked(prisma.documentBrandExtraction.findFirst).mockResolvedValueOnce(
      extraction,
    );
    jest.mocked(provider.isAvailable).mockReturnValue(true);
    const tasks = { enqueue: jest.fn().mockResolvedValue(undefined) };
    service = new DocumentBrandingExtractionService(
      prisma,
      tenantContext,
      provider,
      tasks as never,
    );

    await service.create('entity-1', dto, 'same-key');

    expect(tasks.enqueue).not.toHaveBeenCalled();
    },
  );
});

function makeUniqueConstraintError(index: string) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.10.0',
    meta: {
      driverAdapterError: {
        cause: { constraint: { index } },
      },
    },
  });
}

function makeExtraction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'extraction-1',
    state: 'QUEUED',
    request_hash: 'hash',
    attempt_count: 0,
    proposal: null,
    warning_codes: [],
    base_revision: 0,
    createdAt: new Date(),
    completed_at: null,
    expires_at: null,
    failure_code: null,
    ...overrides,
  };
}
