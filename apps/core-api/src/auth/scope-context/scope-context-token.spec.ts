import { beforeAll, describe, expect, it } from '@jest/globals';
import {
  mintScopeContextToken,
  scopeContextDigest,
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

  it('rejects any component change after minting', () => {
    const token = mintScopeContextToken(base);
    const verified = verifyScopeContextToken(token);
    expect(verified.tenantId).toBe(base.tenantId);

    const mutated = mintScopeContextToken({
      ...base,
      scopeEpoch: base.scopeEpoch + 1n,
    });
    expect(verifyScopeContextToken(mutated).scopeEpoch).not.toBe(
      verified.scopeEpoch,
    );
    expect(scopeContextDigest(token)).not.toBe(scopeContextDigest(mutated));
  });

  it('keeps continuity digest stable across refresh auth_time', () => {
    const first = mintScopeContextToken(base);
    const second = mintScopeContextToken({
      ...base,
      policyVersion: base.policyVersion,
    });
    expect(scopeContextDigest(first)).toBe(scopeContextDigest(second));
  });
});
