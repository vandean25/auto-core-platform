import sharp from 'sharp';
import { HttpException, UnsupportedMediaTypeException } from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DocumentBrandingAssetStorage } from './document-branding-asset-storage.js';
import { DocumentBrandingUploadService } from './document-branding-upload.service.js';

describe('DocumentBrandingUploadService', () => {
  const tenantId = 'tenant-1';
  const legalEntityId = 'entity-1';
  const tenantContext = {
    getTenantId: jest.fn().mockResolvedValue(tenantId),
    getAuthenticatedUser: jest
      .fn()
      .mockReturnValue({ role: 'OWNER', userId: 'firebase-1' }),
  } as unknown as TenantContextService;
  const createAsset = jest.fn(
    async ({ data }: { data: Record<string, unknown> }) => ({
      ...data,
      createdAt: new Date('2026-09-27T12:00:00.000Z'),
    }),
  );
  const quotaCount = jest.fn().mockResolvedValue(0);
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1' }) },
    tenantMember: {
      findFirst: jest.fn().mockResolvedValue({ id: 'member-1' }),
    },
    legalEntity: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: legalEntityId, is_active: true }),
    },
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
      callback({
        legalEntity: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findFirst: jest.fn().mockResolvedValue({ id: legalEntityId }),
        },
        documentBrandAsset: { create: createAsset },
        documentBrandQuotaEvent: {
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          count: quotaCount,
          create: jest.fn().mockResolvedValue({ id: 'quota-1' }),
        },
        documentBrandQuotaLock: {
          upsert: jest.fn().mockResolvedValue({ id: 'lock-1' }),
        },
      }),
    ),
    documentBrandAsset: {
      create: createAsset,
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  } as unknown as PrismaService;
  const storage = {
    storeImmutable: jest.fn(async () => ({
      bucket: 'private-branding',
      generation: '123',
    })),
    readGeneration: jest.fn(),
  } as unknown as DocumentBrandingAssetStorage;
  const tasks = { enqueue: jest.fn().mockResolvedValue(undefined) };
  let service: DocumentBrandingUploadService;

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.legalEntity.findFirst as jest.Mock).mockResolvedValue({
      id: legalEntityId,
      is_active: true,
    });
    createAsset.mockImplementation(async ({ data }) => ({
      ...data,
      createdAt: new Date('2026-09-27T12:00:00.000Z'),
    }));
    (storage.storeImmutable as jest.Mock).mockResolvedValue({
      bucket: 'private-branding',
      generation: '123',
    });
    tasks.enqueue.mockResolvedValue(undefined);
    quotaCount.mockResolvedValue(0);
    service = new DocumentBrandingUploadService(
      prisma,
      tenantContext,
      storage,
      tasks as never,
    );
  });

  it('stores every upload in quarantine and dispatches asynchronous validation without exposing storage locators', async () => {
    const png = await sharp({
      create: { width: 2, height: 2, channels: 4, background: '#ff0000' },
    })
      .png()
      .toBuffer();

    const asset = await service.upload(legalEntityId, 'LOGO', {
      buffer: png,
      size: png.byteLength,
      originalname: '../company.png',
    } as Express.Multer.File);

    expect(asset).toMatchObject({
      purpose: 'LOGO',
      state: 'QUARANTINED',
      detectedMimeType: 'image/png',
      pixelWidth: null,
      pixelHeight: null,
    });
    expect(asset).not.toHaveProperty('bucket');
    expect(asset).not.toHaveProperty('object_key');
    expect(storage.storeImmutable).toHaveBeenCalledTimes(1);
    expect(tasks.enqueue).toHaveBeenCalledWith({
      assetId: expect.any(String),
      tenantId,
    });
    expect(prisma.documentBrandAsset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenant_id: tenantId,
          legal_entity_id: legalEntityId,
          state: 'QUARANTINED',
          original_filename: '.. company.png',
        }),
      }),
    );
  });

  it('rejects an unsupported or spoofed image before storage', async () => {
    await expect(
      service.upload(legalEntityId, 'LOGO', {
        buffer: Buffer.from('not really a PNG'),
        size: 15,
        originalname: 'logo.png',
      } as Express.Multer.File),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    expect(storage.storeImmutable).not.toHaveBeenCalled();
  });

  it('returns a validation error when the legal entity is inactive', async () => {
    (prisma.legalEntity.findFirst as jest.Mock).mockResolvedValue({
      id: legalEntityId,
      is_active: false,
    });
    const png = await sharp({
      create: { width: 2, height: 2, channels: 4, background: '#ff0000' },
    })
      .png()
      .toBuffer();

    await expect(
      service.upload(legalEntityId, 'SOURCE', {
        buffer: png,
        size: png.byteLength,
        originalname: 'letterhead.png',
      } as Express.Multer.File),
    ).rejects.toMatchObject({
      response: { code: 'LEGAL_ENTITY_INACTIVE' },
    });
    expect(storage.storeImmutable).not.toHaveBeenCalled();
  });

  it('enforces the per-entity upload quota before writing to object storage', async () => {
    quotaCount.mockResolvedValue(20);
    const png = await sharp({
      create: { width: 2, height: 2, channels: 4, background: '#ff0000' },
    })
      .png()
      .toBuffer();
    await expect(
      service.upload(legalEntityId, 'LOGO', {
        buffer: png,
        size: png.byteLength,
        originalname: 'logo.png',
      } as Express.Multer.File),
    ).rejects.toMatchObject({
      status: 429,
      response: expect.objectContaining({
        code: 'BRAND_UPLOAD_QUOTA_EXCEEDED',
      }),
    } satisfies Partial<HttpException>);
    expect(storage.storeImmutable).not.toHaveBeenCalled();
  });

  it('keeps PDF sources quarantined until a bounded PDF validator approves them', async () => {
    const pdf = Buffer.from('%PDF-1.7\n%fixture');
    const asset = await service.upload(legalEntityId, 'SOURCE', {
      buffer: pdf,
      size: pdf.byteLength,
      originalname: 'letterhead.pdf',
    } as Express.Multer.File);

    expect(asset).toMatchObject({
      purpose: 'SOURCE',
      state: 'QUARANTINED',
      failureCode: null,
      detectedMimeType: 'application/pdf',
    });
    expect(storage.storeImmutable).toHaveBeenCalledTimes(1);
  });

  it('defers malformed PNG rejection to the asynchronous validator', async () => {
    const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const asset = await service.upload(legalEntityId, 'LOGO', {
      buffer: Buffer.concat([pngHeader, Buffer.from('invalid image data')]),
      size: pngHeader.byteLength + 18,
      originalname: 'broken.png',
    } as Express.Multer.File);

    expect(asset).toMatchObject({ state: 'QUARANTINED', failureCode: null });
    expect(storage.storeImmutable).toHaveBeenCalledTimes(1);
    expect(prisma.documentBrandAsset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: 'QUARANTINED',
          expires_at: expect.any(Date),
        }),
      }),
    );
  });
});
