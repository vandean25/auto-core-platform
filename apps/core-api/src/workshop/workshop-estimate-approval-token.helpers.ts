import { createHash, randomBytes } from 'node:crypto';

/**
 * Approval tokens for a sent estimate version (ADR-0025 §7). The raw token is a 32-byte CSPRNG value and
 * appears only inside the approval link. The database keeps its SHA-256, so a database read cannot approve
 * an estimate. The public route that consumes the token ships in `public-estimate-approval` (phase 5).
 */
const APPROVAL_TOKEN_BYTES = 32;

export interface MintedApprovalToken {
  /** The value inside the approval link. It is never stored and never logged. */
  raw: string;
  /** The stored form: the SHA-256 of `raw`, hex encoded. */
  sha256: string;
}

export function mintApprovalToken(): MintedApprovalToken {
  const raw = randomBytes(APPROVAL_TOKEN_BYTES).toString('base64url');
  return { raw, sha256: hashApprovalToken(raw) };
}

export function hashApprovalToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * The customer-facing base is an absolute https URL with no credentials, query or fragment. Returns it
 * without a trailing slash, or null when it is not usable, so the send can refuse rather than mail a broken
 * link.
 */
export function parseApprovalBaseUrl(value: string | undefined): string | null {
  if (!value || !/^https:\/\//i.test(value) || /\s/.test(value)) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    return null;
  }
  return url.href.replace(/\/+$/, '');
}

/** The approval link for one token. The base comes from `parseApprovalBaseUrl`. */
export function buildApprovalUrl(baseUrl: string, raw: string): string {
  return `${baseUrl}/approve/${raw}`;
}

export interface ApprovalTokenState {
  expires_at: Date;
  invalidated_at: Date | null;
  consumed_at: Date | null;
}

/**
 * A token approves only before its expiry (valid_until, ADR-0025 §7), while it is not invalidated by a
 * re-send or a supersession, and before it is consumed by an approval.
 */
export function isApprovalTokenUsable(
  token: ApprovalTokenState,
  now: Date,
): boolean {
  return (
    token.invalidated_at === null &&
    token.consumed_at === null &&
    now.getTime() < token.expires_at.getTime()
  );
}
