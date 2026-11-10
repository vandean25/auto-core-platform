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

  throw new Error('SCOPE_CONTEXT_HMAC_SECRET is required');
}
