/**
 * Scope names for tenant API keys (ADR-0026). v1 is read-only. Write scopes need their own ADR amendment.
 * A route is callable with an API key only when it declares exactly one of these scopes.
 */
export const PUBLIC_API_SCOPES = [
  'customers:read',
  'vehicles:read',
  'invoices:read',
  'workshop-orders:read',
  'stock:read',
] as const;

export type PublicApiScope = (typeof PUBLIC_API_SCOPES)[number];

export function isPublicApiScope(value: string): value is PublicApiScope {
  return (PUBLIC_API_SCOPES as readonly string[]).includes(value);
}
