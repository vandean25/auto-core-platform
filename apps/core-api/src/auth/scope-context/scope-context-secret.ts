export type ScopeContextHmacSecrets = {
  current: string;
  previous?: string;
};

export function readScopeContextHmacSecrets(): ScopeContextHmacSecrets {
  const current = process.env.SCOPE_CONTEXT_HMAC_SECRET?.trim();
  const previous = process.env.SCOPE_CONTEXT_HMAC_SECRET_PREVIOUS?.trim();

  if (current) {
    return { current, ...(previous ? { previous } : {}) };
  }

  if (process.env.NODE_ENV === 'test') {
    const fallback =
      process.env.SCOPE_CONTEXT_HMAC_SECRET_TEST?.trim() ??
      process.env.TEST_JWT_SECRET?.trim() ??
      'scope-context-test-hmac-secret';
    return { current: fallback };
  }

  throw new Error('SCOPE_CONTEXT_HMAC_SECRET is required');
}
