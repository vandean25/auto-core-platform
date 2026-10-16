import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickWorkshopCommandPresetForSite } from './workshop-command-preset.helpers.js';

const presetUniqueMigrationSql = fs.readFileSync(
  path.join(
    fileURLToPath(new URL('.', import.meta.url)),
    '../../prisma/migrations/20261016113500_aut540_preset_unique_nulls_not_distinct/migration.sql',
  ),
  'utf8',
);

describe('workshop command preset uniqueness', () => {
  it('uses NULLS NOT DISTINCT in the preset unique migration', () => {
    expect(presetUniqueMigrationSql).toContain('NULLS NOT DISTINCT');
  });
});

describe('pickWorkshopCommandPresetForSite', () => {
  it('prefers the site override over a tenant-wide preset', () => {
    const map = pickWorkshopCommandPresetForSite(
      [
        {
          preset_key: 'service.major',
          site_id: null,
          labor_operation_id: 'tenant-labor',
        },
        {
          preset_key: 'service.major',
          site_id: 'site-1',
          labor_operation_id: 'site-labor',
        },
      ],
      'site-1',
    );
    expect(map.get('service.major')?.labor_operation_id).toBe('site-labor');
  });

  it('keeps a single tenant-wide row when no site override exists', () => {
    const map = pickWorkshopCommandPresetForSite(
      [{ preset_key: 'brake.check', site_id: null, labor_operation_id: 'l-1' }],
      'site-9',
    );
    expect(map.get('brake.check')?.labor_operation_id).toBe('l-1');
  });
});
