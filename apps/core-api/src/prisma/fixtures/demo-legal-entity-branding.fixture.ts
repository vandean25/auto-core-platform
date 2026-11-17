import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Prisma } from '@prisma/client';
import sharp from 'sharp';
import {
  BUNDLED_DEMO_BRANDING_BUCKET,
  BUNDLED_DEMO_LOGO_GENERATION,
  BUNDLED_DEMO_LOGO_OBJECT_KEY,
  bundledDemoLogoPath,
} from '../../document-branding/document-branding-asset-storage.js';
import { validateDocumentBrandTheme } from '../../document-branding/theme-v1.js';
import type { SeedPrismaClient } from './types.js';

export const DEMO_WORKSHOP_BRANDING_THEME_DEFAULTS = {
  schemaVersion: 1,
  presetId: 'standard-v1',
  primaryColor: '#1E3A5F',
  secondaryColor: '#E5E7EB',
  fontId: 'acp-sans-v1',
  headerBand: 'primary',
  footerBand: 'secondary',
  headerText: 'Default Workshop',
  footerText: 'Default Workshop · Hauptstraße 1 · 1010 Wien · UID ATU12345678',
} as const;

async function createBundledDemoLogoAsset(
  prisma: SeedPrismaClient,
  tenantId: string,
  legalEntityId: string,
) {
  const logoBytes = await readFile(bundledDemoLogoPath());
  const metadata = await sharp(logoBytes).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('Bundled demo logo PNG is missing pixel dimensions');
  }

  return prisma.documentBrandAsset.create({
    data: {
      tenant_id: tenantId,
      legal_entity_id: legalEntityId,
      purpose: 'LOGO',
      state: 'READY',
      bucket: BUNDLED_DEMO_BRANDING_BUCKET,
      object_key: BUNDLED_DEMO_LOGO_OBJECT_KEY,
      object_generation: BUNDLED_DEMO_LOGO_GENERATION,
      sha256: createHash('sha256').update(logoBytes).digest('hex'),
      byte_length: logoBytes.byteLength,
      detected_mime_type: 'image/png',
      pixel_width: metadata.width,
      pixel_height: metadata.height,
      original_filename: BUNDLED_DEMO_LOGO_OBJECT_KEY,
    },
  });
}

export async function seedDemoWorkshopDocumentBranding(
  prisma: SeedPrismaClient,
  tenantId: string,
  legalEntityId: string,
) {
  const asset = await createBundledDemoLogoAsset(
    prisma,
    tenantId,
    legalEntityId,
  );
  const activeTheme = validateDocumentBrandTheme({
    ...DEMO_WORKSHOP_BRANDING_THEME_DEFAULTS,
    logoAssetId: asset.id,
  });

  const profileData = {
    revision: 1,
    active_revision: 1,
    active_theme: activeTheme as Prisma.InputJsonValue,
    active_logo_asset_id: asset.id,
    draft_theme: Prisma.DbNull,
    draft_logo_asset_id: null,
    draft_source_asset_id: null,
    draft_extraction_id: null,
    confirmed_at: new Date(),
  };

  const profile = await prisma.documentBrandProfile.upsert({
    where: {
      tenant_id_legal_entity_id: {
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
      },
    },
    update: profileData,
    create: {
      tenant_id: tenantId,
      legal_entity_id: legalEntityId,
      ...profileData,
    },
  });

  return { asset, profile };
}
