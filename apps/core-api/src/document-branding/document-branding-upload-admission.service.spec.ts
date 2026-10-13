import {
  BadRequestException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DocumentBrandingAssetStorage } from './document-branding-asset-storage.js';
import { DocumentBrandingUploadAdmissionService } from './document-branding-upload-admission.service.js';
import { DocumentBrandingUploadTaskService } from './document-branding-upload-task.service.js';

const PNG_HEADER = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PDF_BYTES = Buffer.from('%PDF-1.7 synthetic');

describe('DocumentBrandingUploadAdmissionService', () => {
  const tenantId = 'tenant-1';
  const legalEntityId = 'entity-1';
  const tenantContext = {
    getTenantId: jest.fn().mockResolvedValue(tenantId),
    getAuthenticatedUser: jest.fn().mockReturnValue({
      role: 'OWNER',
      userId: 'firebase-user-1',
    }),
  };

  let tx: Record<string, any>;
  let prisma: Record<string, any>;
  let storage: { storeImmutable: jest.Mock; deleteGeneration: jest.Mock };
  let tasks: { enqueue: jest.Mock };
  let service: DocumentBrandingUploadAdmissionService;

  const upload = (buffer: Buffer) =>
    ({
      buffer,
      size: buffer.length,
      originalname: 'brand.png',
    }) as unknown as Express.Multer.File;

  beforeEach(() => {
    jest.clearAllMocks();
    tx = {
      legalEntity: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue({ id: legalEntityId }),
      },
      documentBrandQuotaLock: {
        upsert: jest.fn().mockResolvedValue({ id: 'lock-1' }),
      },
      documentBrandQuotaEvent: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'event-1' }),
      },
      documentBrandAsset: {
        create: jest.fn(async ({ data }) => ({
          ...data,
          createdAt: new Date('2026-10-01T00:00:00Z'),
        })),
      },
    };
    prisma = {
      legalEntity: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: legalEntityId, is_active: true }),
      },
      documentBrandAsset: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1' }) },
      tenantMember: {
        findFirst: jest.fn().mockResolvedValue({ id: 'member-1' }),
      },
      $transaction: jest.fn(async (callback) => callback(tx)),
    };
    storage = {
      storeImmutable: jest
        .fn()
        .mockResolvedValue({ bucket: 'private-branding', generation: '123' }),
      deleteGeneration: jest.fn().mockResolvedValue(undefined),
    };
    tasks = { enqueue: jest.fn().mockResolvedValue(undefined) };
    service = new DocumentBrandingUploadAdmissionService(
      prisma as unknown as PrismaService,
      tenantContext as unknown as TenantContextService,
      storage as unknown as DocumentBrandingAssetStorage,
      tasks as unknown as DocumentBrandingUploadTaskService,
      { getTraceId: () => 'trace-1' } as never,
    );
  });

  it('rejects an unknown purpose before touching the database', async () => {
    await expect(
      service.admit(legalEntityId, 'OTHER', upload(PNG_HEADER)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.legalEntity.findFirst).not.toHaveBeenCalled();
    expect(storage.storeImmutable).not.toHaveBeenCalled();
  });

  it('rejects a logo that is not a PNG before touching the database', async () => {
    await expect(
      service.admit(legalEntityId, 'LOGO', upload(PDF_BYTES)),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    expect(prisma.legalEntity.findFirst).not.toHaveBeenCalled();
  });

  it('stores the quarantine copy, persists the row and dispatches validation with the trace id', async () => {
    const response = await service.admit(
      legalEntityId,
      'LOGO',
      upload(PNG_HEADER),
    );

    expect(response).toMatchObject({
      purpose: 'LOGO',
      state: 'QUARANTINED',
      detectedMimeType: 'image/png',
    });
    expect(tasks.enqueue).toHaveBeenCalledWith({
      assetId: expect.any(String),
      tenantId,
      traceId: 'trace-1',
    });
    expect(prisma.documentBrandAsset.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ tenant_id: tenantId, state: 'QUARANTINED' }),
      data: { validation_dispatched_at: expect.any(Date) },
    });
  });

  it('removes the quarantine copy when the asset row cannot be stored, then rethrows', async () => {
    tx.documentBrandAsset.create.mockRejectedValue(
      new Error('database unavailable'),
    );

    await expect(
      service.admit(legalEntityId, 'LOGO', upload(PNG_HEADER)),
    ).rejects.toThrow('database unavailable');
    expect(storage.deleteGeneration).toHaveBeenCalledWith(
      'private-branding',
      expect.stringContaining('/document-branding/quarantine/'),
      '123',
    );
    expect(tasks.enqueue).not.toHaveBeenCalled();
  });

  it('keeps the quarantined upload when validation cannot be dispatched right away', async () => {
    tasks.enqueue.mockRejectedValue(new Error('queue unavailable'));

    const response = await service.admit(
      legalEntityId,
      'SOURCE',
      upload(PDF_BYTES),
    );

    expect(response).toMatchObject({
      purpose: 'SOURCE',
      state: 'QUARANTINED',
      detectedMimeType: 'application/pdf',
    });
    expect(prisma.documentBrandAsset.updateMany).not.toHaveBeenCalled();
    expect(storage.deleteGeneration).not.toHaveBeenCalled();
  });
});
