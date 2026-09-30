import { Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('document branding persistence contract', () => {
  const models = Prisma.dmmf.datamodel.models;
  const schema = readFileSync(
    resolve(import.meta.dirname, '../../prisma/schema.prisma'),
    'utf8',
  );

  function modelDefinition(name: string) {
    const match = schema.match(
      new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`),
    );
    expect(match).not.toBeNull();
    return match?.[1] ?? '';
  }

  it('stores one tenant- and legal-entity-scoped profile with relational logo references', () => {
    const profile = models.find(
      (model) => model.name === 'DocumentBrandProfile',
    );

    expect(profile).toBeDefined();
    expect(profile?.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining([
        'revision',
        'active_revision',
        'active_theme',
        'draft_theme',
        'active_logo_asset_id',
        'draft_logo_asset_id',
        'draft_source_asset_id',
      ]),
    );
    expect(profile?.fields.map((field) => field.relationName)).toEqual(
      expect.arrayContaining([
        'DocumentBrandActiveLogo',
        'DocumentBrandDraftLogo',
        'DocumentBrandDraftSource',
      ]),
    );

    const profileDefinition = modelDefinition('DocumentBrandProfile');
    expect(profileDefinition).toMatch(
      /@@unique\(\[tenant_id, legal_entity_id\]\)/,
    );
    expect(profileDefinition).toMatch(
      /@@unique\(\[tenant_id, legal_entity_id, id\]\)/,
    );
    expect(profileDefinition).toMatch(
      /references: \[tenant_id, legal_entity_id, id\]/,
    );
  });

  it('records asset ownership and immutable object identity metadata', () => {
    const asset = models.find((model) => model.name === 'DocumentBrandAsset');

    expect(asset).toBeDefined();
    expect(asset?.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining([
        'purpose',
        'state',
        'bucket',
        'object_key',
        'object_generation',
        'sha256',
        'byte_length',
        'detected_mime_type',
        'source_asset_id',
        'expires_at',
        'failure_code',
        'preview_bucket',
        'preview_object_key',
        'preview_object_generation',
      ]),
    );
    expect(modelDefinition('DocumentBrandAsset')).toMatch(
      /@@unique\(\[tenant_id, legal_entity_id, id\]\)/,
    );
  });
});
