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
  });
});
