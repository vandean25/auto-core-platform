import { DocumentBrandingConfirmationService } from './document-branding-confirmation.service.js';
import type { DocumentBrandingProfileStore } from './document-branding-profile-store.service.js';
import { requestHashFor } from './document-branding-profile.rules.js';
import { DEFAULT_DOCUMENT_BRAND_THEME } from './theme-v1.js';

describe('DocumentBrandingConfirmationService', () => {
  const tenantId = 'tenant-1';
  const legalEntityId = 'entity-1';
  const draftProfile = {
    id: 'profile-1',
    tenant_id: tenantId,
    legal_entity_id: legalEntityId,
    revision: 3,
    active_logo_asset_id: null,
    draft_theme: DEFAULT_DOCUMENT_BRAND_THEME,
    draft_logo_asset_id: null,
    draft_source_asset_id: null,
    draft_extraction_id: null,
    last_confirmation_key: null,
    last_confirmation_hash: null,
  };

  let tx: Record<string, any>;
  let profiles: Record<string, jest.Mock>;
  let service: DocumentBrandingConfirmationService;

  function lockedProfileIs(profile: Record<string, unknown>) {
    profiles.withLockedProfile.mockImplementation(async (_id, action) =>
      action(tx, profile, tenantId),
    );
  }

  beforeEach(() => {
    tx = {
      documentBrandAsset: { findFirst: jest.fn().mockResolvedValue(null) },
      documentBrandProfile: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    profiles = {
      withLockedProfile: jest.fn(),
      requireActiveUser: jest.fn().mockResolvedValue({ id: 'user-1' }),
      readResponse: jest
        .fn()
        .mockResolvedValue({ revision: 4, activeRevision: 4 }),
      toResponse: jest.fn((profile) => ({ replayed: profile.revision })),
    };
    service = new DocumentBrandingConfirmationService(
      profiles as unknown as DocumentBrandingProfileStore,
    );
    lockedProfileIs(draftProfile);
  });

  it('rejects a malformed Idempotency-Key before taking the entity lock', async () => {
    await expect(
      service.confirm(legalEntityId, 3, 'not valid'),
    ).rejects.toMatchObject({
      response: { code: 'BRAND_IDEMPOTENCY_KEY_INVALID' },
    });
    expect(profiles.withLockedProfile).not.toHaveBeenCalled();
  });

  it('requires a saved draft before confirming', async () => {
    lockedProfileIs({ ...draftProfile, draft_theme: null });

    await expect(service.confirm(legalEntityId, 3, 'key-1')).rejects.toMatchObject(
      { response: { code: 'BRAND_DRAFT_REQUIRED' } },
    );
    expect(tx.documentBrandProfile.updateMany).not.toHaveBeenCalled();
  });

  it('replays the stored result for the same key and request', async () => {
    lockedProfileIs({
      ...draftProfile,
      last_confirmation_key: 'key-1',
      last_confirmation_hash: requestHashFor(false, 3),
    });

    await expect(service.confirm(legalEntityId, 3, 'key-1')).resolves.toEqual({
      replayed: 3,
    });
    expect(tx.documentBrandProfile.updateMany).not.toHaveBeenCalled();
  });

  it('rejects reuse of an Idempotency-Key for a different request', async () => {
    lockedProfileIs({
      ...draftProfile,
      last_confirmation_key: 'key-1',
      last_confirmation_hash: requestHashFor(true, 3),
    });

    await expect(service.confirm(legalEntityId, 3, 'key-1')).rejects.toMatchObject(
      { response: { code: 'BRAND_IDEMPOTENCY_CONFLICT' } },
    );
  });

  it('promotes the draft to the next active revision and records the confirmation', async () => {
    await expect(service.confirm(legalEntityId, 3, 'key-2')).resolves.toEqual({
      revision: 4,
      activeRevision: 4,
    });

    expect(tx.documentBrandProfile.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'profile-1',
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        revision: 3,
      },
      data: expect.objectContaining({
        revision: 4,
        active_revision: 4,
        active_logo_asset_id: null,
        confirmed_by_user_id: 'user-1',
        last_confirmation_key: 'key-2',
        last_confirmation_hash: requestHashFor(false, 3),
        last_confirmation_result_revision: 4,
      }),
    });
    expect(profiles.readResponse).toHaveBeenCalledWith(
      tx,
      tenantId,
      legalEntityId,
    );
  });

  it('reset clears the active theme without requiring a draft', async () => {
    lockedProfileIs({ ...draftProfile, draft_theme: null });

    await service.reset(legalEntityId, 3, 'key-3');

    expect(tx.documentBrandProfile.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ revision: 3 }),
      data: expect.objectContaining({
        active_logo_asset_id: null,
        last_confirmation_hash: requestHashFor(true, 3),
      }),
    });
  });
});
