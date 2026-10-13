import iconv from 'iconv-lite';

/**
 * Text an RZL import file can carry in a quoted field: non-empty Windows-1252
 * without the field separator, quotes or line breaks, and not formula-leading.
 * Shared by export readiness (blockers) and the serializer's field guard.
 */
export function isRzlSafeText(value: string): boolean {
  if (value.length === 0) {
    return false;
  }
  if (/[\r\n;"]/.test(value) || /^[=+\-@]/.test(value)) {
    return false;
  }
  return iconv.decode(iconv.encode(value, 'win1252'), 'win1252') === value;
}
