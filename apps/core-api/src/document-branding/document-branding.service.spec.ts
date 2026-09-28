import { ConflictException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DocumentBrandingService } from './document-branding.service.js';
import { DEFAULT_DOCUMENT_BRAND_THEME } from './theme-v1.js';

describe('DocumentBrandingService', () => {
  const tenantId = 'tenant-1';
  const legalEntityId = 'entity-1';
  const logoAssetId = '7bead330-4c1b-4b01-9ad5-c2db61946651';
  const tenantContext = {
    getTenantId: jest.fn().mockResolvedValue(tenantId),
    getAuthenticatedUser: jest.fn().mockReturnValue({
      role: 'OWNER',
      userId: 'firebase-user-1',
    }),
  } as unknown as TenantContextService;

  const entity = { id: legalEntityId, is_active: true };
  const previewCount = jest.fn().mockResolvedValue(0);
  const baseProfile = {
    id: 'profile-1',
    tenant_id: tenantId,
    legal_entity_id: legalEntityId,
    revision: 1,
    active_revision: 0,
    active_theme: null,
    draft_theme: null,
    active_logo_asset_id: null,
    draft_logo_asset_id: null,
    confirmed_at: null,
    confirmed_by_user_id: null,
    last_confirmation_key: null,
    last_confirmation_hash: null,
    last_confirmation_result_revision: null,
  };

  let tx: Record<string, any>;
  let prisma: Record<string, any>;
  let service: DocumentBrandingService;

  beforeEach(() => {
    previewCount.mockResolvedValue(0);
    tx = {
      legalEntity: {
        findFirst: jest.fn().mockResolvedValue(entity),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      documentBrandProfile: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }) => ({ ...baseProfile, ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: jest.fn().mockResolvedValue(baseProfile),
      },
      documentBrandAsset: { findFirst: jest.fn().mockResolvedValue(null) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1' }) },
      tenantMember: {
        findFirst: jest.fn().mockResolvedValue({ id: 'member-1' }),
      },
      documentBrandQuotaEvent: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        count: previewCount,
        create: jest.fn().mockResolvedValue({ id: 'quota-1' }),
      },
      documentBrandQuotaLock: {
        upsert: jest.fn().mockResolvedValue({ id: 'lock-1' }),
      },
    };
    prisma = {
      legalEntity: { findFirst: jest.fn().mockResolvedValue(entity) },
      documentBrandProfile: { findFirst: jest.fn().mockResolvedValue(null) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1' }) },
      tenantMember: {
        findFirst: jest.fn().mockResolvedValue({ id: 'member-1' }),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    service = new DocumentBrandingService(
      prisma as unknown as PrismaService,
      tenantContext,
    );
  });

  it('returns defaults without persisting a missing profile', async () => {
    await expect(service.getProfile(legalEntityId)).resolves.toMatchObject({
      revision: 0,
      activeRevision: 0,
      activeTheme: DEFAULT_DOCUMENT_BRAND_THEME,
      draftTheme: null,
    });
    expect(prisma.documentBrandProfile.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('saves the first draft from virtual revision zero as revision one', async () => {
    const draft = {
      ...DEFAULT_DOCUMENT_BRAND_THEME,
      headerText: 'First draft',
    };
    tx.documentBrandProfile.findFirst.mockResolvedValueOnce(null);
    tx.documentBrandProfile.findFirstOrThrow.mockResolvedValue({
      ...baseProfile,
      revision: 1,
      draft_theme: draft,
    });

    await expect(
      service.saveDraft(legalEntityId, { expectedRevision: 0, theme: draft }),
    ).resolves.toMatchObject({ revision: 1, draftTheme: draft });

    expect(tx.documentBrandProfile.create).toHaveBeenCalledWith({
      data: {
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        revision: 0,
      },
    });
    expect(tx.documentBrandProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ revision: 0 }),
        data: expect.objectContaining({ revision: 1, draft_theme: draft }),
      }),
    );
  });

  it('saves only a draft and leaves active branding untouched', async () => {
    const draft = { ...DEFAULT_DOCUMENT_BRAND_THEME, primaryColor: '#123456' };
    const savedProfile = {
      ...baseProfile,
      revision: 2,
      draft_theme: draft,
    };
    tx.documentBrandProfile.findFirst.mockResolvedValue(baseProfile);
    tx.documentBrandProfile.findFirstOrThrow.mockResolvedValue(savedProfile);

    await expect(
      service.saveDraft(legalEntityId, { expectedRevision: 1, theme: draft }),
    ).resolves.toMatchObject({
      revision: 2,
      activeRevision: 0,
      activeTheme: DEFAULT_DOCUMENT_BRAND_THEME,
      draftTheme: draft,
    });
    const updateCall = tx.documentBrandProfile.updateMany.mock.calls[0][0];
    expect(updateCall.where.revision).toBe(1);
    expect(updateCall.data).toMatchObject({ revision: 2, draft_theme: draft });
    expect(updateCall.data).not.toHaveProperty('active_theme');
  });

  it('rejects a stale draft revision', async () => {
    tx.documentBrandProfile.findFirst.mockResolvedValue({
      ...baseProfile,
      revision: 4,
    });
    tx.documentBrandProfile.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.saveDraft(legalEntityId, {
        expectedRevision: 1,
        theme: DEFAULT_DOCUMENT_BRAND_THEME,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a logo from a different legal entity', async () => {
    const theme = { ...DEFAULT_DOCUMENT_BRAND_THEME, logoAssetId };
    tx.documentBrandProfile.findFirst.mockResolvedValue(baseProfile);
    tx.documentBrandAsset.findFirst.mockResolvedValue(null);

    await expect(
      service.saveDraft(legalEntityId, { expectedRevision: 1, theme }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.documentBrandAsset.findFirst).toHaveBeenCalledWith({
      where: {
        id: logoAssetId,
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        purpose: 'LOGO',
        state: 'READY',
      },
      select: { id: true },
    });
  });

  it('records an authorized synthetic preview against the current user quota', async () => {
    await expect(
      service.preview(
        legalEntityId,
        DEFAULT_DOCUMENT_BRAND_THEME,
        'AT_STANDARD',
      ),
    ).resolves.toMatchObject({
      html: expect.stringContaining('SAMPLE — NOT AN INVOICE'),
    });
    expect(tx.documentBrandQuotaEvent.create).toHaveBeenCalledWith({
      data: { tenant_id: tenantId, user_id: 'user-1', action: 'PREVIEW' },
    });
  });

  it('limits synthetic previews to 30 per authenticated user per minute', async () => {
    previewCount.mockResolvedValue(30);
    await expect(
      service.preview(
        legalEntityId,
        DEFAULT_DOCUMENT_BRAND_THEME,
        'AT_STANDARD',
      ),
    ).rejects.toMatchObject({
      status: 429,
      response: expect.objectContaining({
        code: 'BRAND_PREVIEW_QUOTA_EXCEEDED',
      }),
    });
    expect(tx.documentBrandQuotaEvent.create).not.toHaveBeenCalled();
  });

  it('requires idempotency keys for explicit confirmation and reset', async () => {
    await expect(service.confirm(legalEntityId, 1, '')).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('replays the latest confirmation result for an identical idempotency key', async () => {
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ action: 'confirm', expectedRevision: 2 }))
      .digest('hex');
    const confirmedProfile = {
      ...baseProfile,
      revision: 3,
      active_revision: 3,
      active_theme: DEFAULT_DOCUMENT_BRAND_THEME,
      confirmed_at: new Date('2026-09-27T12:00:00.000Z'),
      confirmed_by_user_id: 'user-1',
      last_confirmation_key: 'confirm-once',
      last_confirmation_hash: requestHash,
      last_confirmation_result_revision: 3,
    };
    tx.documentBrandProfile.findFirst.mockResolvedValue(confirmedProfile);

    await expect(
      service.confirm(legalEntityId, 2, 'confirm-once'),
    ).resolves.toMatchObject({ revision: 3, activeRevision: 3 });
    expect(tx.documentBrandProfile.updateMany).not.toHaveBeenCalled();
  });

  it('rejects reuse of a confirmation key with a different request hash', async () => {
    tx.documentBrandProfile.findFirst.mockResolvedValue({
      ...baseProfile,
      last_confirmation_key: 'confirm-once',
      last_confirmation_hash: 'different-hash',
    });

    await expect(
      service.confirm(legalEntityId, 2, 'confirm-once'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BRAND_IDEMPOTENCY_CONFLICT' }),
    });
    expect(tx.documentBrandProfile.updateMany).not.toHaveBeenCalled();
  });
});
