import { describe, expect, it } from '@jest/globals';
import {
  API_KEY_HASH_VERSION,
  API_KEY_TOKEN_PREFIX,
  buildApiKeyDisplayPrefix,
  createApiKeyCredentials,
  hashApiKeySecret,
  isApiKeyToken,
  parseApiKeyToken,
  verifyApiKeySecret,
} from './api-key-token.js';

const PEPPER = Buffer.from('a'.repeat(32), 'utf8');
const OTHER_PEPPER = Buffer.from('b'.repeat(32), 'utf8');
const KEY_ID = '3f9a2c1b-7d4e-4f2a-9b8c-1234567890ab';
const SECRET = 'c'.repeat(64);

describe('api-key-token', () => {
  describe('createApiKeyCredentials', () => {
    it('builds acp_live_<keyId>_<64 hex secret> and never reuses a secret', () => {
      const first = createApiKeyCredentials();
      const second = createApiKeyCredentials();

      expect(first.token).toBe(
        `${API_KEY_TOKEN_PREFIX}${first.keyId}_${first.secret}`,
      );
      expect(first.secret).toMatch(/^[0-9a-f]{64}$/);
      expect(first.keyId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(second.secret).not.toBe(first.secret);
      expect(second.keyId).not.toBe(first.keyId);
    });
  });

  describe('parseApiKeyToken', () => {
    it('round-trips a generated token into its key id and secret', () => {
      const credentials = createApiKeyCredentials();

      expect(parseApiKeyToken(credentials.token)).toEqual({
        keyId: credentials.keyId,
        secret: credentials.secret,
      });
    });

    it.each([
      ['wrong prefix', `acp_test_${KEY_ID}_${SECRET}`],
      ['missing secret', `${API_KEY_TOKEN_PREFIX}${KEY_ID}_`],
      ['short secret', `${API_KEY_TOKEN_PREFIX}${KEY_ID}_${'c'.repeat(63)}`],
      ['uppercase hex', `${API_KEY_TOKEN_PREFIX}${KEY_ID.toUpperCase()}_${SECRET}`],
      ['non-uuid id', `${API_KEY_TOKEN_PREFIX}not-a-uuid_${SECRET}`],
      ['extra segment', `${API_KEY_TOKEN_PREFIX}${KEY_ID}_${SECRET}_x`],
      ['whitespace', ` ${API_KEY_TOKEN_PREFIX}${KEY_ID}_${SECRET}`],
    ])('rejects a malformed token (%s)', (_label, token) => {
      expect(parseApiKeyToken(token)).toBeUndefined();
    });
  });

  describe('isApiKeyToken', () => {
    it('recognises only the acp_live_ prefix', () => {
      expect(isApiKeyToken(`${API_KEY_TOKEN_PREFIX}anything`)).toBe(true);
      expect(isApiKeyToken('eyJhbGciOi.jwt.token')).toBe(false);
      expect(isApiKeyToken('')).toBe(false);
    });
  });

  describe('buildApiKeyDisplayPrefix', () => {
    it('exposes only the first 8 characters of the key id', () => {
      expect(buildApiKeyDisplayPrefix(KEY_ID)).toBe('acp_live_3f9a2c1b');
    });
  });

  describe('hashApiKeySecret / verifyApiKeySecret', () => {
    it('produces a deterministic 64-char hex scrypt digest', async () => {
      const digest = await hashApiKeySecret(KEY_ID, SECRET, PEPPER);

      expect(digest).toMatch(/^[0-9a-f]{64}$/);
      expect(await hashApiKeySecret(KEY_ID, SECRET, PEPPER)).toBe(digest);
    });

    it('does not contain the plaintext secret', async () => {
      expect(await hashApiKeySecret(KEY_ID, SECRET, PEPPER)).not.toContain(SECRET);
    });

    it('changes when the pepper changes', async () => {
      expect(await hashApiKeySecret(KEY_ID, SECRET, OTHER_PEPPER)).not.toBe(
        await hashApiKeySecret(KEY_ID, SECRET, PEPPER),
      );
    });

    it('binds the digest to the key id, so a digest cannot be replayed onto another row', async () => {
      const otherKeyId = '00000000-0000-4000-8000-000000000000';

      expect(await hashApiKeySecret(otherKeyId, SECRET, PEPPER)).not.toBe(
        await hashApiKeySecret(KEY_ID, SECRET, PEPPER),
      );
    });

    it('verifies the matching secret and rejects any other secret', async () => {
      const storedHash = await hashApiKeySecret(KEY_ID, SECRET, PEPPER);

      expect(await verifyApiKeySecret(KEY_ID, SECRET, storedHash, PEPPER)).toBe(
        true,
      );
      expect(
        await verifyApiKeySecret(KEY_ID, 'd'.repeat(64), storedHash, PEPPER),
      ).toBe(false);
      expect(
        await verifyApiKeySecret(KEY_ID, SECRET, storedHash, OTHER_PEPPER),
      ).toBe(false);
    });

    it('rejects a stored hash that is not a 32-byte digest instead of throwing', async () => {
      expect(await verifyApiKeySecret(KEY_ID, SECRET, 'not-hex', PEPPER)).toBe(
        false,
      );
      expect(await verifyApiKeySecret(KEY_ID, SECRET, '', PEPPER)).toBe(false);
    });
  });

  it('pins the digest scheme version used for new keys', () => {
    expect(API_KEY_HASH_VERSION).toBe(1);
  });
});
