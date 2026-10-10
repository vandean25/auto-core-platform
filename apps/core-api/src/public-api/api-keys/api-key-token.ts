import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Public, non-secret token prefix. The guard routes any Bearer token that starts with it to the
 * API key path instead of Firebase verification (ADR-0026).
 */
export const API_KEY_TOKEN_PREFIX = 'acp_live_';

/** Digest scheme stored in `TenantApiKey.hash_version`. Bump when the pepper or digest changes. */
export const API_KEY_HASH_VERSION = 1;

const SECRET_BYTES = 32;
const DIGEST_BYTES = 32;

/**
 * scrypt cost for the stored digest (ADR-0026). The 256-bit secret carries the security, so the cost
 * is kept low: it is paid on every key-authenticated request.
 */
const SCRYPT_OPTIONS = { N: 4096, r: 8, p: 1, maxmem: 16 * 1024 * 1024 };

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
 * scrypt digest of `keyId:secret`, with the server pepper as the salt (ADR-0026). The key id is part
 * of the password so a digest cannot be replayed onto another key row.
 */
export function hashApiKeySecret(
  keyId: string,
  secret: string,
  pepper: Buffer,
): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(
      `${keyId}:${secret}`,
      pepper,
      DIGEST_BYTES,
      SCRYPT_OPTIONS,
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey.toString('hex'));
      },
    );
  });
}

/** Constant-time comparison of the recomputed digest against the stored digest. */
export async function verifyApiKeySecret(
  keyId: string,
  secret: string,
  storedHash: string,
  pepper: Buffer,
): Promise<boolean> {
  const expected = Buffer.from(
    await hashApiKeySecret(keyId, secret, pepper),
    'hex',
  );
  const stored = Buffer.from(storedHash, 'hex');
  if (stored.length !== DIGEST_BYTES) {
    return false;
  }

  return timingSafeEqual(expected, stored);
}
