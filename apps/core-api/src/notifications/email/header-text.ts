/**
 * Text that becomes a header value, such as a subject or a display name, stays on one line and carries
 * no control characters (AUT-356). That covers C0 and C1 controls, DEL, and the Unicode line and
 * paragraph separators, since some header parsers treat NEL (U+0085) as a line break too. Commas and
 * quotes are allowed here: adapters quote display names when they format a header.
 */
export function isSingleLineText(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (
      code < 0x20 ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x2028 ||
      code === 0x2029
    ) {
      return false;
    }
  }
  return true;
}
