import { randomBytes } from 'node:crypto';

const MIN_PEPPER_BYTES = 32;

let testFallbackPepper: Buffer | undefined;

/**
 * Returns the server pepper for tenant API key digests, or `undefined` when it is not configured.
 * Callers must treat `undefined` as fail-closed: key creation returns 503 and every key is rejected.
 *
 * Test runs without `API_KEY_PEPPER` use one random pepper per process, matching how AuthService
 * handles the test JWT secret. Production never falls back.
 */
export function resolveApiKeyPepper(): Buffer | undefined {
  const raw = process.env.API_KEY_PEPPER?.trim();
  if (raw) {
    const decoded = Buffer.from(raw, 'base64');
    return decoded.length >= MIN_PEPPER_BYTES ? decoded : undefined;
  }

  if (process.env.NODE_ENV === 'test') {
    testFallbackPepper ??= randomBytes(MIN_PEPPER_BYTES);
    return testFallbackPepper;
  }

  return undefined;
}
