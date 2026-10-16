import { createHash, randomBytes } from 'node:crypto';

const UNSUBSCRIBE_TOKEN_BYTES = 32;

export interface MintedUnsubscribeToken {
  raw: string;
  sha256: string;
}

export function mintUnsubscribeToken(): MintedUnsubscribeToken {
  const raw = randomBytes(UNSUBSCRIBE_TOKEN_BYTES).toString('base64url');
  return { raw, sha256: hashUnsubscribeToken(raw) };
}

export function hashUnsubscribeToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}
