import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Public, non-secret token prefix. The guard routes any Bearer token that starts with it to the
 * API key path instead of Firebase verification (ADR-0026).
 */
export const API_KEY_TOKEN_PREFIX = 'acp_live_';

/** Digest scheme stored in `TenantApiKey.hash_version`. Bump when the pepper or digest changes. */
export const API_KEY_HASH_VERSION = 1;

const SECRET_BYTES = 32;
const DIGEST_BYTES = 32;

const TOKEN_PATTERN =
  /^acp_live_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_([0-9a-f]{64})$/;

export type ApiKeyCredentials = {
  /** Row id. Public, used as the lookup handle inside the token. */
  keyId: string;
  /** High-entropy secret. Returned to the caller once and never stored. */
  secret: string;
  /** `acp_live_<keyId>_<secret>`. Returned once at creation. */
  token: string;
};

export type ParsedApiKeyToken = {
  keyId: string;
  secret: string;
};

export function isApiKeyToken(value: string): boolean {
  return value.startsWith(API_KEY_TOKEN_PREFIX);
}

export function createApiKeyCredentials(): ApiKeyCredentials {
  const keyId = randomUUID();
  const secret = randomBytes(SECRET_BYTES).toString('hex');

  return {
    keyId,
    secret,
    token: `${API_KEY_TOKEN_PREFIX}${keyId}_${secret}`,
  };
}

/** Display-only prefix shown in key lists. It is not a secret and is never used for authentication. */
export function buildApiKeyDisplayPrefix(keyId: string): string {
  return `${API_KEY_TOKEN_PREFIX}${keyId.slice(0, 8)}`;
}

export function parseApiKeyToken(token: string): ParsedApiKeyToken | undefined {
  const match = TOKEN_PATTERN.exec(token);
  if (!match) {
    return undefined;
  }

  return { keyId: match[1] ?? '', secret: match[2] ?? '' };
}

/**
 * HMAC-SHA256 digest of `keyId:secret` keyed by the server pepper. The key id is part of the
 * message so a digest cannot be replayed onto another key row.
 */
export function hashApiKeySecret(
  keyId: string,
  secret: string,
  pepper: Buffer,
): string {
  return createHmac('sha256', pepper)
    .update(`${keyId}:${secret}`, 'utf8')
    .digest('hex');
}

/** Constant-time comparison of the recomputed digest against the stored digest. */
export function verifyApiKeySecret(
  keyId: string,
  secret: string,
  storedHash: string,
  pepper: Buffer,
): boolean {
  const expected = Buffer.from(hashApiKeySecret(keyId, secret, pepper), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  if (stored.length !== DIGEST_BYTES) {
    return false;
  }

  return timingSafeEqual(expected, stored);
}
