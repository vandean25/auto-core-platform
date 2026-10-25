export type AuthClaims = {
  tenantId?: string
  role?: string
  platformRole?: string
}

export function extractAuthClaims(rawClaims: Record<string, unknown>): AuthClaims {
  return {
    tenantId: typeof rawClaims.tenantId === 'string' ? rawClaims.tenantId : undefined,
    role: typeof rawClaims.role === 'string' ? rawClaims.role : undefined,
    platformRole:
      typeof rawClaims.platformRole === 'string' ? rawClaims.platformRole : undefined,
  }
}
