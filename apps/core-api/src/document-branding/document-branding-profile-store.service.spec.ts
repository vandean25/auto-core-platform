import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DocumentBrandingProfileStore } from './document-branding-profile-store.service.js';
import { DEFAULT_DOCUMENT_BRAND_THEME } from './theme-v1.js';

describe('DocumentBrandingProfileStore', () => {
  const tenantId = 'tenant-1';
  const legalEntityId = 'entity-1';
  const tenantContext = {
    getTenantId: jest.fn().mockResolvedValue(tenantId),
    getAuthenticatedUser: jest.fn().mockReturnValue({
      role: 'OWNER',
      userId: 'firebase-user-1',
    }),
  } as unknown as TenantContextService;

  let prisma: Record<string, any>;
  let store: DocumentBrandingProfileStore;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      legalEntity: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: legalEntityId, is_active: true }),
      },
      documentBrandProfile: { findFirst: jest.fn().mockResolvedValue(null) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1' }) },
      tenantMember: {
        findFirst: jest.fn().mockResolvedValue({ id: 'member-1' }),
      },
      $transaction: jest.fn(),
    };
    store = new DocumentBrandingProfileStore(
      prisma as unknown as PrismaService,
      tenantContext,
    );
  });

  it('creates a revision-zero profile inside the entity lock before running the action', async () => {
    const created = {
      id: 'profile-1',
      tenant_id: tenantId,
      legal_entity_id: legalEntityId,
      revision: 0,
    };
    const tx = {
      legalEntity: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: legalEntityId, is_active: true }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      documentBrandProfile: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(created),
      },
    };
    prisma.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => unknown) => callback(tx),
    );
    const action = jest.fn(async (_tx, profile, scopedTenantId) => ({
      profileId: profile.id,
      scopedTenantId,
    }));

    await expect(store.withLockedProfile(legalEntityId, action)).resolves.toEqual(
      { profileId: 'profile-1', scopedTenantId: tenantId },
    );
    expect(tx.documentBrandProfile.create).toHaveBeenCalledWith({
      data: {
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        revision: 0,
      },
    });
    expect(action).toHaveBeenCalledWith(tx, created, tenantId);
  });

  it('rejects branding changes for an inactive legal entity', async () => {
    prisma.legalEntity.findFirst.mockResolvedValue({
      id: legalEntityId,
      is_active: false,
    });

    await expect(
      store.requireActiveLegalEntity(tenantId, legalEntityId),
    ).rejects.toMatchObject({
      response: { code: 'LEGAL_ENTITY_INACTIVE' },
    });
  });

  it('maps a stored profile to the API response shape', () => {
    expect(
      store.toResponse({
        id: 'profile-1',
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        revision: 2,
        active_revision: 1,
        active_theme: null,
        draft_theme: null,
        active_logo_asset_id: null,
        draft_logo_asset_id: null,
        draft_source_asset_id: null,
        draft_extraction_id: null,
        confirmed_at: null,
        confirmed_by_user_id: null,
        last_confirmation_key: null,
        last_confirmation_hash: null,
        last_confirmation_result_revision: null,
      } as never),
    ).toMatchObject({
      revision: 2,
      activeRevision: 1,
      activeTheme: DEFAULT_DOCUMENT_BRAND_THEME,
      draftTheme: null,
      draftSourceAssetId: null,
      draftSourceAsset: null,
    });
  });
});
