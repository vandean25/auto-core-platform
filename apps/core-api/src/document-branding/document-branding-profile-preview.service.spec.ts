import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DocumentBrandingAssetStorage } from './document-branding-asset-storage.js';
import { DocumentBrandingProfilePreviewService } from './document-branding-profile-preview.service.js';
import type { DocumentBrandingProfileStore } from './document-branding-profile-store.service.js';
import { DEFAULT_DOCUMENT_BRAND_THEME } from './theme-v1.js';

const logoAssetId = '7bead330-4c1b-4b01-9ad5-c2db61946651';

describe('DocumentBrandingProfilePreviewService', () => {
  const tenantId = 'tenant-1';
  const legalEntityId = 'entity-1';

  let tenantContext: { getTenantId: jest.Mock; getAuthenticatedUser: jest.Mock };
  let tx: Record<string, any>;
  let prisma: Record<string, any>;
  let profiles: Record<string, jest.Mock>;
  let storage: { readGeneration: jest.Mock };
  let service: DocumentBrandingProfilePreviewService;

  beforeEach(() => {
    tenantContext = {
      getTenantId: jest.fn().mockResolvedValue(tenantId),
      getAuthenticatedUser: jest.fn().mockReturnValue({
        role: 'OWNER',
        userId: 'firebase-user-1',
      }),
    };
    tx = {
      documentBrandQuotaLock: {
        upsert: jest.fn().mockResolvedValue({ id: 'lock-1' }),
      },
      documentBrandQuotaEvent: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'event-1' }),
      },
    };
    prisma = {
      documentBrandAsset: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (callback) => callback(tx)),
    };
    profiles = {
      requireActiveUser: jest.fn().mockResolvedValue({ id: 'user-1' }),
      requireActiveLegalEntity: jest
        .fn()
        .mockResolvedValue({ id: legalEntityId, is_active: true }),
    };
    storage = {
      readGeneration: jest.fn().mockResolvedValue(Buffer.from('png-bytes')),
    };
    service = new DocumentBrandingProfilePreviewService(
      prisma as unknown as PrismaService,
      tenantContext as unknown as TenantContextService,
      profiles as unknown as DocumentBrandingProfileStore,
      storage as unknown as DocumentBrandingAssetStorage,
    );
  });

  it('rejects an oversized request before any tenant or database access', async () => {
    const theme = {
      ...DEFAULT_DOCUMENT_BRAND_THEME,
      headerText: 'x'.repeat(17 * 1024),
    };

    await expect(
      service.preview(legalEntityId, theme, 'AT_STANDARD'),
    ).rejects.toMatchObject({
      response: { code: 'BRAND_PREVIEW_TOO_LARGE' },
    });
    expect(tenantContext.getTenantId).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('throttles previews once the per-minute limit is reached', async () => {
    tx.documentBrandQuotaEvent.count.mockResolvedValue(30);

    await expect(
      service.preview(legalEntityId, DEFAULT_DOCUMENT_BRAND_THEME, 'AT_STANDARD'),
    ).rejects.toMatchObject({
      response: { code: 'BRAND_PREVIEW_QUOTA_EXCEEDED' },
    });
    expect(tx.documentBrandQuotaEvent.create).not.toHaveBeenCalled();
  });

  it('renders a theme without a logo and reads no stored assets', async () => {
    const preview = await service.preview(
      legalEntityId,
      DEFAULT_DOCUMENT_BRAND_THEME,
      'DE_STANDARD',
    );

    expect(preview.html).toEqual(expect.any(String));
    expect(profiles.requireActiveLegalEntity).toHaveBeenCalledWith(
      tenantId,
      legalEntityId,
    );
    expect(prisma.documentBrandAsset.findFirst).not.toHaveBeenCalled();
    expect(storage.readGeneration).not.toHaveBeenCalled();
    expect(tx.documentBrandQuotaEvent.create).toHaveBeenCalledWith({
      data: { tenant_id: tenantId, user_id: 'user-1', action: 'PREVIEW' },
    });
  });

  it('reports the logo as unavailable when its stored generation is missing', async () => {
    prisma.documentBrandAsset.findFirst
      .mockResolvedValueOnce({ id: logoAssetId, state: 'READY' })
      .mockResolvedValueOnce({
        bucket: null,
        object_key: 'logo.png',
        object_generation: '42',
      });

    await expect(
      service.preview(
        legalEntityId,
        { ...DEFAULT_DOCUMENT_BRAND_THEME, logoAssetId },
        'AT_STANDARD',
      ),
    ).rejects.toMatchObject({
      response: { code: 'BRAND_PREVIEW_ASSET_UNAVAILABLE' },
    });
    expect(storage.readGeneration).not.toHaveBeenCalled();
  });

  it('reads the stored logo generation for the preview', async () => {
    prisma.documentBrandAsset.findFirst
      .mockResolvedValueOnce({ id: logoAssetId, state: 'READY' })
      .mockResolvedValueOnce({
        bucket: 'private-branding',
        object_key: 'logo.png',
        object_generation: '42',
      });

    await service.preview(
      legalEntityId,
      { ...DEFAULT_DOCUMENT_BRAND_THEME, logoAssetId },
      'AT_STANDARD',
    );

    expect(storage.readGeneration).toHaveBeenCalledWith(
      'private-branding',
      'logo.png',
      '42',
    );
  });
});
