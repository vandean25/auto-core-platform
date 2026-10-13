import {
  buildApprovalUrl,
  hashApprovalToken,
  isApprovalTokenUsable,
  mintApprovalToken,
  parseApprovalBaseUrl,
} from './workshop-estimate-approval-token.helpers.js';

// 27 October 2026 is winter time, so 09:00 UTC is the cut-off instant.
const VALID_UNTIL = new Date('2026-10-27T09:00:00Z');
const SENT_AT = new Date('2026-10-13T10:00:00Z');

describe('workshop estimate approval tokens (ADR-0025 §7)', () => {
  it('mints a 32-byte URL-safe token and keeps only its SHA-256', () => {
    const token = mintApprovalToken();

    expect(Buffer.from(token.raw, 'base64url')).toHaveLength(32);
    expect(token.raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(token.sha256).toBe(hashApprovalToken(token.raw));
  });

  it('mints a different token on every call', () => {
    const raws = new Set(
      Array.from({ length: 50 }, () => mintApprovalToken().raw),
    );

    expect(raws.size).toBe(50);
  });

  it('accepts only an absolute https base without credentials, query or fragment', () => {
    expect(parseApprovalBaseUrl('https://portal.example.at')).toBe(
      'https://portal.example.at',
    );
    expect(parseApprovalBaseUrl('https://portal.example.at/')).toBe(
      'https://portal.example.at',
    );
    expect(parseApprovalBaseUrl('https://portal.example.at/kunden/')).toBe(
      'https://portal.example.at/kunden',
    );

    for (const value of [
      undefined,
      '',
      'portal.example.at',
      'http://portal.example.at',
      'https:portal.example.at',
      'https://user:pw@portal.example.at',
      'https://portal.example.at/?x=1',
      'https://portal.example.at/#top',
      'https://portal.example.at/ab cd',
      'https://',
    ]) {
      expect(parseApprovalBaseUrl(value)).toBeNull();
    }
  });

  it('builds the approval link from the base and the raw token', () => {
    expect(buildApprovalUrl('https://portal.example.at', 'abc_DEF-123')).toBe(
      'https://portal.example.at/approve/abc_DEF-123',
    );
  });

  it('approves only before expiry, and not after an invalidation or a consumption', () => {
    const live = {
      expires_at: VALID_UNTIL,
      invalidated_at: null,
      consumed_at: null,
    };
    const beforeExpiry = new Date('2026-10-27T08:59:59Z');
    const atExpiry = new Date('2026-10-27T09:00:00Z');

    expect(isApprovalTokenUsable(live, beforeExpiry)).toBe(true);
    expect(isApprovalTokenUsable(live, atExpiry)).toBe(false);
    expect(
      isApprovalTokenUsable({ ...live, invalidated_at: SENT_AT }, beforeExpiry),
    ).toBe(false);
    expect(
      isApprovalTokenUsable({ ...live, consumed_at: SENT_AT }, beforeExpiry),
    ).toBe(false);
  });
});
