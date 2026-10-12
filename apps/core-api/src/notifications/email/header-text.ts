/**
 * Text that becomes a header value, such as a subject or a display name, stays on one line and carries
 * no control characters (AUT-356). That covers C0 and C1 controls, DEL, and the Unicode line and
 * paragraph separators, since some header parsers treat NEL (U+0085) as a line break too. It also refuses
 * the bidi overrides and isolates and the zero-width characters, which can make a name read differently
 * from what it says. Commas and quotes are allowed here: adapters quote display names when they format a header.
 */
export function isSingleLineText(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (
      code < 0x20 ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x2028 ||
      code === 0x2029 ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2060 && code <= 0x2064) ||
      (code >= 0x2066 && code <= 0x2069) ||
      code === 0xfeff
    ) {
      return false;
    }
  }
  return true;
}
