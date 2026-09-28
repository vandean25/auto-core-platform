import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service.js';
import { DocumentBrandingAssetStorage } from './document-branding-asset-storage.js';
import { DocumentBrandingPdfParser } from './document-branding-pdf-parser.js';
import { DocumentBrandingUploadWorkerService } from './document-branding-upload-worker.service.js';

describe('DocumentBrandingUploadWorkerService', () => {
  const lease = new Date('2026-09-28T12:15:00.000Z');
  const asset = {
    id: 'asset-1',
    tenant_id: 'tenant-1',
    legal_entity_id: 'entity-1',
    purpose: 'LOGO',
    state: 'QUARANTINED',
    detected_mime_type: 'image/png',
    quarantine_bucket: 'private-branding',
    quarantine_object_key: 'quarantine/asset-1',
    quarantine_object_generation: '123',
    validation_attempt_count: 0,
    expires_at: lease,
  };
  const findFirst = jest.fn().mockResolvedValue(asset);
  const updateMany = jest
    .fn()
    .mockResolvedValueOnce({ count: 1 })
    .mockResolvedValueOnce({ count: 1 });
  const prisma = {
    documentBrandAsset: { findFirst, updateMany },
  } as unknown as PrismaService;
  const storage = {
    readGeneration: jest.fn(),
    storeImmutable: jest
      .fn()
      .mockResolvedValue({ bucket: 'private-branding', generation: '456' }),
    deleteGeneration: jest.fn(),
  } as unknown as DocumentBrandingAssetStorage;
  const pdfParser = {
    validateAndRasterize: jest.fn(),
  } as unknown as DocumentBrandingPdfParser;
  let service: DocumentBrandingUploadWorkerService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(lease.getTime() - 5 * 60 * 1000);
    findFirst.mockResolvedValue({ ...asset });
    updateMany
      .mockReset()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    (storage.readGeneration as jest.Mock).mockResolvedValue(
      await sharp({
        create: { width: 2, height: 3, channels: 4, background: '#ff0000' },
      })
        .png()
        .toBuffer(),
    );
    (storage.storeImmutable as jest.Mock).mockResolvedValue({
      bucket: 'private-branding',
      generation: '456',
    });
    service = new DocumentBrandingUploadWorkerService(
      prisma,
      storage,
      pdfParser,
    );
  });

  afterEach(() => jest.useRealTimers());

  it('re-encodes a quarantined logo then atomically publishes its immutable generation', async () => {
    await expect(service.validate('asset-1', 'tenant-1')).resolves.toEqual({
      state: 'READY',
    });
    expect(updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'asset-1',
          tenant_id: 'tenant-1',
          state: 'QUARANTINED',
        }),
        data: expect.objectContaining({
          validation_attempt_count: { increment: 1 },
          validation_lease_until: expect.any(Date),
        }),
      }),
    );
    expect(storage.storeImmutable).toHaveBeenCalledWith(
      expect.objectContaining({
        objectKey:
          'tenants/tenant-1/legal-entities/entity-1/document-branding/assets/asset-1.png',
        contentType: 'image/png',
      }),
    );
    expect(updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          validation_lease_until: expect.any(Date),
        }),
        data: expect.objectContaining({
          state: 'READY',
          object_generation: '456',
          pixel_width: 2,
          pixel_height: 3,
        }),
      }),
    );
    expect(storage.deleteGeneration).toHaveBeenCalledWith(
      'private-branding',
      'quarantine/asset-1',
      '123',
    );
  });

  it('rejects malformed PNG content and retains it in quarantine for expiry cleanup', async () => {
    (storage.readGeneration as jest.Mock).mockResolvedValue(
      Buffer.from('bad PNG'),
    );
    await expect(service.validate('asset-1', 'tenant-1')).resolves.toEqual({
      state: 'REJECTED',
    });
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: 'REJECTED',
          failure_code: 'BRAND_PNG_INVALID',
          validation_lease_until: null,
        }),
      }),
    );
    expect(storage.storeImmutable).not.toHaveBeenCalled();
  });

  it('reports pixel-limit PNGs as dimension failures and never publishes them', async () => {
    (storage.readGeneration as jest.Mock).mockResolvedValue(
      await sharp({
        create: {
          width: 4097,
          height: 4096,
          channels: 4,
          background: '#ff0000',
        },
      })
        .png()
        .toBuffer(),
    );

    await expect(service.validate('asset-1', 'tenant-1')).resolves.toEqual({
      state: 'REJECTED',
    });

    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: 'REJECTED',
          failure_code: 'BRAND_PNG_DIMENSIONS_INVALID',
        }),
      }),
    );
    expect(storage.storeImmutable).not.toHaveBeenCalled();
  });

  it('rejects PNGs whose side exceeds the per-image limit', async () => {
    (storage.readGeneration as jest.Mock).mockResolvedValue(
      await sharp({
        create: {
          width: 8193,
          height: 1,
          channels: 4,
          background: '#ff0000',
        },
      })
        .png()
        .toBuffer(),
    );

    await expect(service.validate('asset-1', 'tenant-1')).resolves.toEqual({
      state: 'REJECTED',
    });

    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failure_code: 'BRAND_PNG_DIMENSIONS_INVALID',
        }),
      }),
    );
    expect(storage.storeImmutable).not.toHaveBeenCalled();
  });

  it('fully decodes source PNGs before publishing the original bytes', async () => {
    findFirst.mockResolvedValue({ ...asset, purpose: 'SOURCE' });
    const validPng = await sharp({
      create: { width: 12, height: 8, channels: 4, background: '#ff0000' },
    })
      .png()
      .toBuffer();
    (storage.readGeneration as jest.Mock).mockResolvedValue(
      validPng.subarray(0, Math.floor(validPng.length / 2)),
    );

    await expect(service.validate('asset-1', 'tenant-1')).resolves.toEqual({
      state: 'REJECTED',
    });
    expect(storage.storeImmutable).not.toHaveBeenCalled();
  });

  it('resizes large logos to a 1024-pixel maximum side', async () => {
    (storage.readGeneration as jest.Mock).mockResolvedValue(
      await sharp({
        create: {
          width: 1200,
          height: 600,
          channels: 4,
          background: '#ff0000',
        },
      })
        .png()
        .toBuffer(),
    );

    await service.validate('asset-1', 'tenant-1');

    const published = (storage.storeImmutable as jest.Mock).mock.calls[0][0];
    await expect(sharp(published.bytes).metadata()).resolves.toEqual(
      expect.objectContaining({ width: 1024, height: 512 }),
    );
  });

  it('validates source PDFs in the bounded parser process and retains the original file', async () => {
    findFirst.mockResolvedValue({
      ...asset,
      purpose: 'SOURCE',
      detected_mime_type: 'application/pdf',
    });
    (storage.readGeneration as jest.Mock).mockResolvedValue(
      Buffer.from('%PDF-1.7 fixture'),
    );
    (pdfParser.validateAndRasterize as jest.Mock).mockResolvedValue({
      pageCount: 2,
      width: 1024,
      height: 1448,
      raster: Buffer.from('png'),
      warning: 'PDF_ADDITIONAL_PAGES_IGNORED',
    });

    await expect(service.validate('asset-1', 'tenant-1')).resolves.toEqual({
      state: 'READY',
    });
    expect(pdfParser.validateAndRasterize).toHaveBeenCalledWith(
      Buffer.from('%PDF-1.7 fixture'),
    );
    expect(storage.storeImmutable).toHaveBeenCalledWith(
      expect.objectContaining({
        bytes: Buffer.from('%PDF-1.7 fixture'),
        contentType: 'application/pdf',
        objectKey: expect.stringMatching(/asset-1\.pdf$/),
      }),
    );
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: 'READY',
          expires_at: expect.any(Date),
        }),
      }),
    );
  });

  it('does not publish when a duplicate task cannot acquire the validation lease', async () => {
    updateMany.mockReset().mockResolvedValue({ count: 0 });
    await expect(service.validate('asset-1', 'tenant-1')).resolves.toEqual({
      state: 'QUARANTINED',
    });
    expect(storage.readGeneration).not.toHaveBeenCalled();
  });

  it('deletes a published generation when the conditional READY update loses its lease', async () => {
    updateMany
      .mockReset()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await expect(service.validate('asset-1', 'tenant-1')).resolves.toEqual({
      state: 'QUARANTINED',
    });

    expect(storage.deleteGeneration).toHaveBeenCalledWith(
      'private-branding',
      'tenants/tenant-1/legal-entities/entity-1/document-branding/assets/asset-1.png',
      '456',
    );
  });

  it('deletes a published generation when persisting READY throws', async () => {
    const error = new Error('database unavailable');
    updateMany
      .mockReset()
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ count: 1 });

    await expect(service.validate('asset-1', 'tenant-1')).rejects.toBe(error);

    expect(storage.deleteGeneration).toHaveBeenCalledWith(
      'private-branding',
      'tenants/tenant-1/legal-entities/entity-1/document-branding/assets/asset-1.png',
      '456',
    );
  });
});
