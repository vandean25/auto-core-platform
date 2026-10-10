import type { TenantAuthenticatedUser } from '../../auth/types/authenticated-user.js';

/**
 * `role` of an API-key principal. It is not a TenantMemberRole, so every role check denies it.
 * Session-only services therefore refuse it even if a route is reached by mistake.
 */
export const API_KEY_PRINCIPAL_ROLE = 'API_KEY';

/** Verified state of one tenant API key for the current request (ADR-0026). Never holds the secret. */
export type ApiKeyPrincipal = {
  apiKeyId: string;
  tenantId: string;
  keyPrefix: string;
  scopes: readonly string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
  rateLimitPerMinute: number;
};

export function toApiKeyTenantUser(
  principal: ApiKeyPrincipal,
): TenantAuthenticatedUser & { apiKeyId: string } {
  return {
    userId: `api-key:${principal.apiKeyId}`,
    email: '',
    tenantId: principal.tenantId,
    role: API_KEY_PRINCIPAL_ROLE,
    apiKeyId: principal.apiKeyId,
  };
}
