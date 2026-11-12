/** Request header name (ADR-0038 D7); must match `apps/core-api` `scope-context.constants`. */
export const SCOPE_CONTEXT_HEADER = 'X-ACP-Scope-Context'

export const SCOPE_CONTEXT_HANDSHAKE_PATH = '/api/auth/scope-context'
export const SCOPE_CONTEXT_LOGOUT_PATH = '/api/auth/logout'

/** Cross-tab signal that session lineage changed in another browser tab (ADR-0038 §3). */
export const SCOPE_CONTEXT_SESSION_LINEAGE_STORAGE_KEY = 'acp:scope-context:session-lineage'
