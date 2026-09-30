import {
  startDerivedLogoGraceIfUnreferenced,
  startDraftSourceGraceIfUnreferenced,
} from './document-branding-extraction-retention.js';

describe('startDerivedLogoGraceIfUnreferenced', () => {
  const now = new Date('2026-09-29T12:00:00.000Z');
  let tx: Record<string, any>;

  beforeEach(() => {
    tx = {
      documentBrandProfile: { findFirst: jest.fn().mockResolvedValue(null) },
      invoiceBrandAssetReference: { findFirst: jest.fn().mockResolvedValue(null) },
      documentBrandExtraction: { findFirst: jest.fn().mockResolvedValue(null) },
      documentBrandAsset: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
  });

  it('starts a seven-day grace period when no profile, invoice, or live proposal references the logo', async () => {
    await startDerivedLogoGraceIfUnreferenced(tx as never, {
      tenantId: 'tenant-1',
      legalEntityId: 'entity-1',
      assetId: 'logo-1',
      now,
    });

    expect(tx.documentBrandAsset.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'logo-1',
        tenant_id: 'tenant-1',
        legal_entity_id: 'entity-1',
        purpose: 'LOGO',
        state: 'READY',
      }),
      data: { expires_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) },
    });
  });

  it.each(['profile', 'invoice', 'proposal'])('preserves the logo while a %s reference exists', async (reference) => {
    if (reference === 'profile') {
      tx.documentBrandProfile.findFirst.mockResolvedValue({ id: 'profile-1' });
    }
    if (reference === 'invoice') {
      tx.invoiceBrandAssetReference.findFirst.mockResolvedValue({ id: 'reference-1' });
    }
    if (reference === 'proposal') {
      tx.documentBrandExtraction.findFirst.mockResolvedValue({ id: 'extraction-1' });
    }

    await startDerivedLogoGraceIfUnreferenced(tx as never, {
      tenantId: 'tenant-1',
      legalEntityId: 'entity-1',
      assetId: 'logo-1',
      now,
    });

    expect(tx.documentBrandAsset.updateMany).not.toHaveBeenCalled();
  });
});

describe('startDraftSourceGraceIfUnreferenced', () => {
  const now = new Date('2026-09-29T12:00:00.000Z');
  let tx: Record<string, any>;

  beforeEach(() => {
    tx = {
      documentBrandProfile: { findFirst: jest.fn().mockResolvedValue(null) },
      documentBrandExtraction: { findFirst: jest.fn().mockResolvedValue(null) },
      documentBrandAsset: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
  });

  it('starts grace when no draft or extraction references the source', async () => {
    await startDraftSourceGraceIfUnreferenced(tx as never, {
      tenantId: 'tenant-1',
      legalEntityId: 'entity-1',
      assetId: 'source-1',
      now,
    });

    expect(tx.documentBrandAsset.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'source-1',
        purpose: 'SOURCE',
      }),
      data: { expires_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) },
    });
  });

  it('preserves the source while it remains attached to the draft profile', async () => {
    tx.documentBrandProfile.findFirst.mockResolvedValue({ id: 'profile-1' });

    await startDraftSourceGraceIfUnreferenced(tx as never, {
      tenantId: 'tenant-1',
      legalEntityId: 'entity-1',
      assetId: 'source-1',
      now,
    });

    expect(tx.documentBrandAsset.updateMany).not.toHaveBeenCalled();
  });
});
