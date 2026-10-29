const IMPORT_SOURCE_KEY_SEGMENT_MAX_LENGTH = 64;
const IMPORT_SOURCE_KEY_MAX_SEGMENTS = 2;
// Mirrors the manifest namespaceCode grammar so canonical keys keep their identity.
const CANONICAL_KEY_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SLUG_KEY_SEGMENT_PATTERN = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;

export function normalizeImportSourceKey(raw: string): string {
  const canonical = raw.trim().toLowerCase();
  if (
    canonical.includes(':') &&
    canonical
      .split(':')
      .every((segment) => CANONICAL_KEY_SEGMENT_PATTERN.test(segment))
  ) {
    return canonical;
  }
  return raw.split(':').map(normalizeImportSourceKeySegment).join(':');
}

function normalizeImportSourceKeySegment(segment: string): string {
  const collapsed = segment
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/-+/g, '-');
  return trimHyphens(collapsed);
}

// A /-+$/ regex backtracks quadratically on long dash runs.
function trimHyphens(value: string): string {
  const start = value.startsWith('-') ? 1 : 0;
  const end = value.endsWith('-') ? value.length - 1 : value.length;
  return value.slice(start, end);
}

export function validateImportSourceKey(
  key: string,
): { valid: true } | { valid: false; error: string } {
  if (!key) {
    return { valid: false, error: 'Import source key is required' };
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

  const segments = key.split(':');
  if (segments.length > IMPORT_SOURCE_KEY_MAX_SEGMENTS) {
    return {
      valid: false,
      error: 'Import source key must contain at most one colon',
    };
  }
  if (segments.some((segment) => segment.length === 0)) {
    return {
      valid: false,
      error: 'Import source key must not contain empty segments',
    };
  }
  if (
    segments.some(
      (segment) => segment.length > IMPORT_SOURCE_KEY_SEGMENT_MAX_LENGTH,
    )
  ) {
    return {
      valid: false,
      error: `Import source key must be at most ${IMPORT_SOURCE_KEY_SEGMENT_MAX_LENGTH} characters per segment`,
    };
  }
  const isCanonical = segments.length === IMPORT_SOURCE_KEY_MAX_SEGMENTS;
  const segmentPattern = isCanonical
    ? CANONICAL_KEY_SEGMENT_PATTERN
    : SLUG_KEY_SEGMENT_PATTERN;
  if (segments.some((segment) => !segmentPattern.test(segment))) {
    return {
      valid: false,
      error: isCanonical
        ? 'Import source key segments must start with a letter or digit and contain only lower-case letters, digits, hyphens, and underscores'
        : 'Import source key must contain only alphanumeric characters, hyphens, and underscores, and must not start or end with a hyphen',
    };
  }
  return { valid: true };
}
