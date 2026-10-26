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
  if (token === '' || tokenContainsWhitespace(token)) {
    return undefined;
  }
  return token;
}

function tokenContainsWhitespace(token: string): boolean {
  for (let index = 0; index < token.length; index += 1) {
    const code = token.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}
