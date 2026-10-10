import { SetMetadata } from '@nestjs/common';
import type { PublicApiScope } from '../public-api-scopes.js';

export const PUBLIC_API_SCOPE_KEY = 'publicApiScope';

/**
 * Marks a route as callable with a tenant API key that holds `scope` (ADR-0026).
 *
 * Deny by default: a route without this decorator rejects every API key with 403, so session-only
 * endpoints can never be reached through a key.
 */
export const RequirePublicApiScope = (scope: PublicApiScope) =>
  SetMetadata(PUBLIC_API_SCOPE_KEY, scope);
