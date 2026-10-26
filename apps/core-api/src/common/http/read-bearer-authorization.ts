const BEARER_PREFIX = 'bearer ';

/** Parses `Authorization: Bearer <token>` without regex (CodeQL-safe). */
export function readBearerTokenFromAuthorizationHeader(
  authorizationHeader: string | undefined,
): string | undefined {
  if (authorizationHeader === undefined) {
    return undefined;
  }
  const trimmed = authorizationHeader.trim();
  if (trimmed.length <= BEARER_PREFIX.length) {
    return undefined;
  }
  if (trimmed.slice(0, BEARER_PREFIX.length).toLowerCase() !== BEARER_PREFIX) {
    return undefined;
  }
  const token = trimmed.slice(BEARER_PREFIX.length).trim();
  if (token === '' || token.includes(' ') || token.includes('\t')) {
    return undefined;
  }
  return token;
}
