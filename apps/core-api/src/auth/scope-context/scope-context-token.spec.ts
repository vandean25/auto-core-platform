import { beforeAll, describe, expect, it } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import { continuityDigestForSignIn } from './scope-context-continuity.js';
import {
  buildContinuityDigest,
  continuityDigestCandidates,
  mintScopeContextToken,
  verifyScopeContextToken,
} from './scope-context-token.js';

describe('scope context token (AUT-937)', () => {
  beforeAll(() => {
    process.env.SCOPE_CONTEXT_HMAC_SECRET = 'unit-test-scope-context-hmac-secret';
  });

  const base = {
    principalSub: 'user-subject',
    continuityDigest: 'abcd'.repeat(16),
    tenantId: '11111111-1111-4111-8111-111111111111',
    siteId: '22222222-2222-4222-8222-222222222222',
    scopeEpoch: 3n,
    authorizationEpoch: 7n,
    policyVersion: 'policy-v1',
  } as const;

  it('rejects tampered scope context tokens', () => {
    const token = mintScopeContextToken(base);
  const tampered = `${token.slice(0, -1)}x`;
    expect(() => verifyScopeContextToken(tampered)).toThrow(
      UnauthorizedException,
    );
  });

  it('keeps continuity digest stable for the same auth_time', () => {
    const subject = 'user-subject';
    const authTime = 1_700_000_000;
    const first = buildContinuityDigest(subject, authTime);
    const second = buildContinuityDigest(subject, authTime);
    expect(first).toBe(second);
    expect(
      continuityDigestForSignIn(
        process.env.SCOPE_CONTEXT_HMAC_SECRET!,
        subject,
        authTime,
      ),
    ).toBe(first);
  });

  it('changes continuity digest when auth_time changes', () => {
    const subject = 'user-subject';
    const earlier = buildContinuityDigest(subject, 1_700_000_000);
    const later = buildContinuityDigest(subject, 1_700_000_001);
    expect(earlier).not.toBe(later);
    expect(continuityDigestCandidates(subject, 1_700_000_000)).toContain(earlier);
  });

  it('rejects payload drift after minting', () => {
    const token = mintScopeContextToken(base);
    const verified = verifyScopeContextToken(token);
    expect(verified.scopeEpoch).toBe(base.scopeEpoch);
    const mutated = mintScopeContextToken({
      ...base,
      scopeEpoch: base.scopeEpoch + 1n,
    });
    expect(verifyScopeContextToken(mutated).scopeEpoch).not.toBe(
      verified.scopeEpoch,
    );
  });
});
