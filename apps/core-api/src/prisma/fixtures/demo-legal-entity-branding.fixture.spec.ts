import { createHash } from 'node:crypto';
import {
  BUNDLED_DEMO_BRANDING_BUCKET,
  BUNDLED_DEMO_LOGO_GENERATION,
  BUNDLED_DEMO_LOGO_OBJECT_KEY,
  DocumentBrandingAssetStorage,
} from '../../document-branding/document-branding-asset-storage.js';
import { validateDocumentBrandTheme } from '../../document-branding/theme-v1.js';
import { isValidBrandLogoAsset } from '../../invoices/invoice-snapshot-v2.helpers.js';
import { seedDemoWorkshopDocumentBranding } from './demo-legal-entity-branding.fixture.js';

describe('demo-legal-entity-branding.fixture', () => {
  it('seeds a READY demo logo asset and confirmed DocumentBrandProfile for Default Workshop', async () => {
    const assetId = '11111111-1111-4111-8111-111111111111';
    const createdAssets: Array<Record<string, unknown>> = [];
    const upsertedProfiles: Array<Record<string, unknown>> = [];

    const mockPrisma: any = {
      documentBrandAsset: {
        create: jest.fn().mockImplementation(async ({ data }) => {
          const row = { id: assetId, ...data };
          createdAssets.push(row);
          return row;
        }),
      },
      documentBrandProfile: {
        upsert: jest.fn().mockImplementation(async ({ create }) => {
          upsertedProfiles.push(create);
          return { id: 'profile-1', ...create };
        }),
      },
    };

    const result = await seedDemoWorkshopDocumentBranding(
      mockPrisma,
      'tenant-1',
      'le-1',
    );

    expect(createdAssets).toHaveLength(1);
    const asset = createdAssets[0];
    expect(asset).toMatchObject({
      tenant_id: 'tenant-1',
      legal_entity_id: 'le-1',
      purpose: 'LOGO',
      state: 'READY',
      bucket: BUNDLED_DEMO_BRANDING_BUCKET,
      object_key: BUNDLED_DEMO_LOGO_OBJECT_KEY,
      object_generation: BUNDLED_DEMO_LOGO_GENERATION,
      detected_mime_type: 'image/png',
      original_filename: 'demo-workshop-logo.png',
    });
    expect(isValidBrandLogoAsset(asset as never)).toBe(true);

    const storage = new DocumentBrandingAssetStorage();
    const logoBytes = await storage.readGeneration(
      asset.bucket as string,
      asset.object_key as string,
      asset.object_generation as string,
    );
    expect(createHash('sha256').update(logoBytes).digest('hex')).toBe(
      asset.sha256,
    );
    expect(logoBytes.byteLength).toBe(asset.byte_length);

    expect(upsertedProfiles).toHaveLength(1);
    const profile = upsertedProfiles[0];
    expect(profile).toMatchObject({
      tenant_id: 'tenant-1',
      legal_entity_id: 'le-1',
      revision: 1,
      active_revision: 1,
      active_logo_asset_id: assetId,
    });
    expect(profile.confirmed_at).toBeInstanceOf(Date);

    const validatedTheme = validateDocumentBrandTheme(profile.active_theme);
    expect(validatedTheme.logoAssetId).toBe(assetId);
    expect(validatedTheme.headerBand).toBe('primary');
    expect(validatedTheme.headerText.length).toBeGreaterThan(0);
    expect(validatedTheme.footerText.length).toBeGreaterThan(0);

    expect(result.asset.id).toBe(assetId);
    expect(result.profile.active_revision).toBe(1);
  });
});
