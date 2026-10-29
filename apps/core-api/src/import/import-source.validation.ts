const IMPORT_SOURCE_KEY_MAX_LENGTH = 64;
const IMPORT_SOURCE_KEY_PATTERN = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;

export function normalizeImportSourceKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function validateImportSourceKey(
  key: string,
): { valid: true } | { valid: false; error: string } {
  if (!key) {
    return { valid: false, error: 'Import source key is required' };
  }
  if (key.length > IMPORT_SOURCE_KEY_MAX_LENGTH) {
    return {
      valid: false,
      error: `Import source key must be at most ${IMPORT_SOURCE_KEY_MAX_LENGTH} characters`,
    };
  }
  if (key !== key.toLowerCase()) {
    return {
      valid: false,
      error: 'Import source key must be lower-case',
    };
  }
  if (/\s/.test(key)) {
    return {
      valid: false,
      error: 'Import source key must not contain spaces; use hyphens',
    };
  }
  if (!IMPORT_SOURCE_KEY_PATTERN.test(key)) {
    return {
      valid: false,
      error:
        'Import source key must contain only alphanumeric characters, hyphens, and underscores, and must not start or end with a hyphen',
    };
  }
  return { valid: true };
}
