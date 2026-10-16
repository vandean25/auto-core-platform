const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ActivityActionOrTraceFilter = {
  traceId?: string
  actionType?: string
}

/** Maps Activity tab action/trace search text to API query filters. */
export function parseActivityActionOrTraceSearch(
  input: string,
): ActivityActionOrTraceFilter {
  const trimmed = input.trim()
  if (!trimmed) {
    return {}
  }

  if (UUID_PATTERN.test(trimmed)) {
    return { traceId: trimmed }
  }

  return { actionType: trimmed }
}
