export type TenantAuthenticatedUser = {
  userId: string;
  email: string;
  tenantId: string;
  role: string;
  activeSiteId?: string | null;
  platformRole?: string;
  /** `auth_time` of the verified ID token: the sign-in lineage that a Scope Context is bound to (ADR-0038 §3). */
  authTimeSeconds?: number;
  /**
   * AUT-411: set only for a request authenticated with a tenant API key (ADR-0026). Such a request
   * runs as a tenant-bound service principal with no user, and `role` is `API_KEY`.
   */
  apiKeyId?: string;
};

export type PlatformAuthenticatedUser = {
  userId: string;
  email: string;
  platformRole: string;
  tenantId?: string;
  role?: string;
};

export type AuthenticatedUser =
  TenantAuthenticatedUser | PlatformAuthenticatedUser;

/** True only for a request whose principal was verified by ApiKeyAuthGuard. */
export function isApiKeyPrincipal(
  user: AuthenticatedUser | undefined,
): user is TenantAuthenticatedUser & { apiKeyId: string } {
  return (
    typeof (user as TenantAuthenticatedUser | undefined)?.apiKeyId === 'string'
  );
}
