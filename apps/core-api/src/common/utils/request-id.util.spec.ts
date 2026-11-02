import { describe, it, expect } from '@jest/globals';
import { resolveRequestId, sanitizeInboundRequestId } from './request-id.util.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('sanitizeInboundRequestId', () => {
  it('returns a valid inbound id unchanged', () => {
    expect(sanitizeInboundRequestId('req-746.ok:1_2')).toBe('req-746.ok:1_2');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeInboundRequestId('  req-746  ')).toBe('req-746');
  });

  it('accepts the maximum allowed length', () => {
    const value = 'a'.repeat(128);
    expect(sanitizeInboundRequestId(value)).toBe(value);
  });

  it('drops an oversized value', () => {
    expect(sanitizeInboundRequestId('a'.repeat(129))).toBeUndefined();
  });

  it('drops a value with a disallowed character', () => {
    expect(sanitizeInboundRequestId('bad id with spaces')).toBeUndefined();
    expect(sanitizeInboundRequestId('bad/slash')).toBeUndefined();
    expect(sanitizeInboundRequestId('bad#hash')).toBeUndefined();
  });

  it('drops empty or whitespace-only values', () => {
    expect(sanitizeInboundRequestId('')).toBeUndefined();
    expect(sanitizeInboundRequestId('   ')).toBeUndefined();
    expect(sanitizeInboundRequestId(undefined)).toBeUndefined();
  });

  it('picks the first non-empty entry from a repeated header', () => {
    expect(sanitizeInboundRequestId(['   ', ' client-req ', 'second'])).toBe(
      'client-req',
    );
  });

  it('drops an array whose only value is oversized or invalid', () => {
    expect(sanitizeInboundRequestId(['a'.repeat(129)])).toBeUndefined();
    expect(sanitizeInboundRequestId(['bad id'])).toBeUndefined();
  });
});

describe('resolveRequestId', () => {
  it('returns a generated UUID when the inbound value is unusable', () => {
    expect(resolveRequestId('bad id')).toMatch(UUID_PATTERN);
    expect(resolveRequestId('a'.repeat(129))).toMatch(UUID_PATTERN);
    expect(resolveRequestId(undefined)).toMatch(UUID_PATTERN);
  });

  it('returns the sanitized inbound id when valid', () => {
    expect(resolveRequestId(' client-req ')).toBe('client-req');
  });
});
