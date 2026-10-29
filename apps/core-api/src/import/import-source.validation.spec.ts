import {
  normalizeImportSourceKey,
  validateImportSourceKey,
} from './import-source.validation.js';

describe('import source key validation', () => {
  describe('normalizeImportSourceKey', () => {
    it('trims whitespace', () => {
      expect(normalizeImportSourceKey('  legacy-dms  ')).toBe('legacy-dms');
    });

    it('converts to lower case', () => {
      expect(normalizeImportSourceKey('Legacy-DMS')).toBe('legacy-dms');
    });

    it('replaces spaces with hyphens', () => {
      expect(normalizeImportSourceKey('legacy dms')).toBe('legacy-dms');
    });

    it('removes disallowed characters', () => {
      expect(normalizeImportSourceKey('legacy@dms!')).toBe('legacydms');
    });

    it('allows hyphens and underscores', () => {
      expect(normalizeImportSourceKey('legacy-dms_v2')).toBe('legacy-dms_v2');
    });

    it('collapses multiple hyphens', () => {
      expect(normalizeImportSourceKey('legacy--dms')).toBe('legacy-dms');
    });

    it('strips leading and trailing hyphens', () => {
      expect(normalizeImportSourceKey('-legacy-dms-')).toBe('legacy-dms');
    });

    it('handles empty string after normalization', () => {
      expect(normalizeImportSourceKey('   ')).toBe('');
    });

    it('handles mixed case and special characters', () => {
      expect(normalizeImportSourceKey('  Incasea-DMS!  ')).toBe('incasea-dms');
    });

    it('preserves a canonical source_name:source_company_code key', () => {
      expect(normalizeImportSourceKey('synthetic_dms:synth_fixture')).toBe(
        'synthetic_dms:synth_fixture',
      );
    });

    it('normalizes each segment of a canonical key', () => {
      expect(normalizeImportSourceKey('  Synthetic DMS : Synth Fixture  ')).toBe(
        'synthetic-dms:synth-fixture',
      );
    });

    it('keeps extra colons for validation to reject', () => {
      expect(normalizeImportSourceKey('a:b:c')).toBe('a:b:c');
    });

    it('preserves a canonical segment ending with an underscore', () => {
      expect(normalizeImportSourceKey('dms:shop_')).toBe('dms:shop_');
    });

    it('preserves consecutive hyphens in a canonical segment', () => {
      expect(normalizeImportSourceKey('dms--prod:shop')).toBe('dms--prod:shop');
    });
  });

  describe('validateImportSourceKey', () => {
    it('returns valid for normalized key', () => {
      const result = validateImportSourceKey('legacy-dms');
      expect(result.valid).toBe(true);
      expect(result).not.toHaveProperty('error');
    });

    it('returns invalid for empty key', () => {
      const result = validateImportSourceKey('');
      expect(result.valid).toBe(false);
      if (result.valid) throw new Error('expected invalid');
      expect(result.error).toContain('required');
    });

    it('returns invalid for key exceeding max length', () => {
      const longKey = 'a'.repeat(65);
      const result = validateImportSourceKey(longKey);
      expect(result.valid).toBe(false);
      if (result.valid) throw new Error('expected invalid');
      expect(result.error).toContain('64');
    });

    it('returns invalid for key with uppercase', () => {
      const result = validateImportSourceKey('Legacy-DMS');
      expect(result.valid).toBe(false);
      if (result.valid) throw new Error('expected invalid');
      expect(result.error).toContain('lower-case');
    });

    it('returns invalid for key with spaces', () => {
      const result = validateImportSourceKey('legacy dms');
      expect(result.valid).toBe(false);
      if (result.valid) throw new Error('expected invalid');
      expect(result.error).toContain('hyphens');
    });

    it('returns invalid for key with special characters', () => {
      const result = validateImportSourceKey('legacy@dms');
      expect(result.valid).toBe(false);
      if (result.valid) throw new Error('expected invalid');
      expect(result.error).toContain('alphanumeric');
    });

    it('returns valid for key with hyphens and underscores', () => {
      const result = validateImportSourceKey('legacy-dms_v2');
      expect(result.valid).toBe(true);
    });

    it('returns valid for a single alphanumeric character', () => {
      expect(validateImportSourceKey('a').valid).toBe(true);
    });

    it('returns invalid for a key made only of hyphens', () => {
      expect(validateImportSourceKey('-'.repeat(64)).valid).toBe(false);
    });

    it('returns invalid for a key made only of underscores', () => {
      expect(validateImportSourceKey('_'.repeat(64)).valid).toBe(false);
    });

    it('returns invalid for key starting with hyphen', () => {
      const result = validateImportSourceKey('-legacy-dms');
      expect(result.valid).toBe(false);
      if (result.valid) throw new Error('expected invalid');
      expect(result.error).toContain('hyphen');
    });

    it('returns invalid for key ending with hyphen', () => {
      const result = validateImportSourceKey('legacy-dms-');
      expect(result.valid).toBe(false);
      if (result.valid) throw new Error('expected invalid');
      expect(result.error).toContain('hyphen');
    });

    it('returns valid for a canonical source_name:source_company_code key', () => {
      const result = validateImportSourceKey('synthetic_dms:synth_fixture');
      expect(result.valid).toBe(true);
    });

    it('returns valid for a canonical segment ending with an underscore', () => {
      expect(validateImportSourceKey('dms:shop_').valid).toBe(true);
    });

    it('returns valid for a canonical segment with consecutive hyphens', () => {
      expect(validateImportSourceKey('dms--prod:shop').valid).toBe(true);
    });

    it('returns invalid for more than one colon', () => {
      const result = validateImportSourceKey('a:b:c');
      expect(result.valid).toBe(false);
      if (result.valid) throw new Error('expected invalid');
      expect(result.error).toContain('colon');
    });

    it('returns invalid for an empty segment', () => {
      const result = validateImportSourceKey('synthetic_dms:');
      expect(result.valid).toBe(false);
      if (result.valid) throw new Error('expected invalid');
      expect(result.error).toContain('empty');
    });

    it('returns invalid when a segment exceeds max length', () => {
      const result = validateImportSourceKey(`${'a'.repeat(65)}:b`);
      expect(result.valid).toBe(false);
      if (result.valid) throw new Error('expected invalid');
      expect(result.error).toContain('64');
    });
  });
});
