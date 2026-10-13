import { DocumentBrandingDraftService } from './document-branding-draft.service.js';
import type { DocumentBrandingProfileStore } from './document-branding-profile-store.service.js';
import { DEFAULT_DOCUMENT_BRAND_THEME } from './theme-v1.js';

describe('DocumentBrandingDraftService', () => {
  const tenantId = 'tenant-1';
  const legalEntityId = 'entity-1';
  const profileRow = {
    id: 'profile-1',
    tenant_id: tenantId,
    legal_entity_id: legalEntityId,
    revision: 3,
    draft_theme: null,
    draft_logo_asset_id: null,
    draft_source_asset_id: null,
    draft_extraction_id: null,
    active_logo_asset_id: null,
  };

  let tx: Record<string, any>;
  let profiles: Record<string, jest.Mock>;
  let service: DocumentBrandingDraftService;

  beforeEach(() => {
    tx = {
      documentBrandAsset: { findFirst: jest.fn().mockResolvedValue(null) },
      documentBrandExtraction: { findFirst: jest.fn().mockResolvedValue(null) },
      documentBrandProfile: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    profiles = {
      withLockedProfile: jest.fn(async (_legalEntityId, action) =>
        action(tx, profileRow, tenantId),
      ),
      readResponse: jest.fn().mockResolvedValue({ revision: 4 }),
      toResponse: jest.fn((profile) => ({ revision: profile.revision })),
    };
    service = new DocumentBrandingDraftService(
      profiles as unknown as DocumentBrandingProfileStore,
    );
  });

  it('returns the current profile and skips the write when no draft is stored', async () => {
    await expect(service.discardDraft(legalEntityId, 3)).resolves.toEqual({
      revision: 3,
    });
    expect(tx.documentBrandProfile.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a stale revision before checking the letterhead source', async () => {
    await expect(
      service.setDraftSource(legalEntityId, {
        expectedRevision: 1,
        sourceAssetId: 'asset-1',
      }),
    ).rejects.toMatchObject({
      response: { code: 'BRAND_REVISION_CONFLICT' },
    });
    expect(tx.documentBrandAsset.findFirst).not.toHaveBeenCalled();
    expect(tx.documentBrandProfile.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a saved extraction that is no longer available for this revision', async () => {
    await expect(
      service.saveDraft(legalEntityId, {
        expectedRevision: 3,
        theme: DEFAULT_DOCUMENT_BRAND_THEME,
        extractionId: 'extraction-1',
      }),
    ).rejects.toMatchObject({
      response: { code: 'BRAND_EXTRACTION_STALE' },
    });
    expect(tx.documentBrandExtraction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'extraction-1',
          tenant_id: tenantId,
          base_revision: 3,
          state: 'SUCCEEDED',
        }),
      }),
    );
    expect(tx.documentBrandProfile.updateMany).not.toHaveBeenCalled();
  });

  it('saves the draft theme at the next revision and reads the profile back', async () => {
    const draft = { ...DEFAULT_DOCUMENT_BRAND_THEME, headerText: 'Draft' };

    await expect(
      service.saveDraft(legalEntityId, {
        expectedRevision: 3,
        theme: draft,
      }),
    ).resolves.toEqual({ revision: 4 });

    expect(tx.documentBrandProfile.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'profile-1',
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        revision: 3,
      },
      data: expect.objectContaining({
        revision: 4,
        draft_logo_asset_id: null,
        draft_extraction_id: null,
      }),
    });
    expect(profiles.readResponse).toHaveBeenCalledWith(
      tx,
      tenantId,
      legalEntityId,
    );
  });
});
