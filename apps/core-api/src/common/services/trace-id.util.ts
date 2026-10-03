/** RFC 4122 UUID (any version). */
export const TRACE_ID_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTraceIdUuid(value: string): boolean {
  return TRACE_ID_UUID_REGEX.test(value);
}
