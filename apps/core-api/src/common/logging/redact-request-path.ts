/**
 * The approval link token is a credential that sits in the URL path (ADR-0025 §7). Anything that logs or reports a
 * request path passes it through here, so the token never reaches application logs or error reports.
 *
 * The token follows `estimate-approvals` and a separator. The router reads a backslash as a separator and routes the
 * segment in any letter case, so either separator and any case count. The token ends at the next separator, a query
 * or a fragment.
 */
const APPROVAL_TOKEN_SEGMENT = /(estimate-approvals[\\/])[^\\/?#\s"]+/gi;

/** The global search text is customer data (names, emails, phones, plates), so nothing of its query string is logged. */
const SEARCH_QUERY = /(\/search\/?)\?[^#\s"]*/gi;

/** Sentry also attaches the raw query string under these keys, without the path. */
const QUERY_STRING_KEYS = new Set(['query_string', 'url.query', 'http.query']);
const SEARCH_TEXT_PARAM = /([?&]|^)q=[^&#\s"]*/g;

const MAX_SCRUB_DEPTH = 12;

export function redactRequestPath(path: string): string {
  return path
    .replace(APPROVAL_TOKEN_SEGMENT, '$1:token')
    .replace(SEARCH_QUERY, '$1?:redacted');
}

/**
 * Redacts every string inside a Sentry event (request URL, transaction name, breadcrumbs, and so on). Bounded
 * depth, so a cyclic object cannot loop.
 */
export function redactEventPaths<T>(value: T): T {
  return scrubValue(value, 0) as T;
}

function scrubValue(value: unknown, depth: number): unknown {
  if (depth > MAX_SCRUB_DEPTH) {
    return value;
  }
  if (typeof value === 'string') {
    return redactRequestPath(value);
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => scrubValue(item, depth + 1));
  }
  if (value !== null && typeof value === 'object') {
    const scrubbed: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      scrubbed[key] =
        QUERY_STRING_KEYS.has(key) && typeof item === 'string'
          ? item.replace(SEARCH_TEXT_PARAM, '$1q=:redacted')
          : scrubValue(item, depth + 1);
    }
    return scrubbed;
  }
  return value;
}
