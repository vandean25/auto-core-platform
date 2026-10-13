import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DocumentBrandingAssetReaderService } from './document-branding-asset-reader.service.js';
import { DocumentBrandingAssetStorage } from './document-branding-asset-storage.js';

describe('DocumentBrandingAssetReaderService', () => {
  const tenantId = 'tenant-1';
  const legalEntityId = 'entity-1';
  const tenantContext = {
    getTenantId: jest.fn().mockResolvedValue(tenantId),
    getAuthenticatedUser: jest.fn().mockReturnValue({
      role: 'ADMIN',
      userId: 'firebase-user-1',
    }),
  };
  const readyLogo = {
    id: 'asset-1',
    tenant_id: tenantId,
    legal_entity_id: legalEntityId,
    purpose: 'LOGO',
    state: 'READY',
    detected_mime_type: 'image/png',
    byte_length: 8,
    pixel_width: 2,
    pixel_height: 2,
    failure_code: null,
    original_filename: 'brand.png',
    bucket: 'private-branding',
    object_key: 'logo.png',
    object_generation: '7',
    preview_bucket: null,
    preview_object_key: null,
    preview_object_generation: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    expires_at: null,
  };

  let prisma: Record<string, any>;
  let storage: { readGeneration: jest.Mock };
  let service: DocumentBrandingAssetReaderService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      documentBrandAsset: { findFirst: jest.fn().mockResolvedValue(null) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1' }) },
      tenantMember: {
        findFirst: jest.fn().mockResolvedValue({ id: 'member-1' }),
      },
    };
    storage = {
      readGeneration: jest.fn().mockResolvedValue(Buffer.from('png-bytes')),
    };
    service = new DocumentBrandingAssetReaderService(
      prisma as unknown as PrismaService,
      tenantContext as unknown as TenantContextService,
      storage as unknown as DocumentBrandingAssetStorage,
    );
  });

  it('does not expose an asset that belongs to another legal entity', async () => {
    await expect(service.getAsset(legalEntityId, 'asset-9')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.documentBrandAsset.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'asset-9',
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
      },
    });
  });

  it('refuses to download an asset that is not ready', async () => {
    prisma.documentBrandAsset.findFirst.mockResolvedValue({
      ...readyLogo,
      state: 'QUARANTINED',
    });

    await expect(
      service.getAssetContent(legalEntityId, 'asset-1'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(storage.readGeneration).not.toHaveBeenCalled();
  });

  it('returns the stored bytes for a ready asset', async () => {
    prisma.documentBrandAsset.findFirst.mockResolvedValue(readyLogo);

    await expect(
      service.getAssetContent(legalEntityId, 'asset-1'),
    ).resolves.toEqual({
      bytes: Buffer.from('png-bytes'),
      contentType: 'image/png',
      purpose: 'LOGO',
    });
    expect(storage.readGeneration).toHaveBeenCalledWith(
      'private-branding',
      'logo.png',
      '7',
    );
  });

  it('serves the page preview generation as PNG', async () => {
    prisma.documentBrandAsset.findFirst.mockResolvedValue({
      ...readyLogo,
      purpose: 'SOURCE',
      preview_bucket: 'private-branding',
      preview_object_key: 'preview.png',
      preview_object_generation: '9',
    });

    await expect(
      service.getAssetPagePreview(legalEntityId, 'asset-1'),
    ).resolves.toEqual({
      bytes: Buffer.from('png-bytes'),
      contentType: 'image/png',
    });
    expect(storage.readGeneration).toHaveBeenCalledWith(
      'private-branding',
      'preview.png',
      '9',
    );
  });
});
