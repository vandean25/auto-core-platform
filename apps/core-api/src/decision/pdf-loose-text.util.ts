/**
 * Best-effort literal string extraction for shadow-mode document sorting only.
 * Not used for business logic outcomes beyond the heuristic classifier.
 */
export function extractLoosePdfText(bytes: Buffer): string {
  const raw = bytes.toString('latin1');
  const chunks: string[] = [];
  const literalPattern = /\(([^\\)]*)\)/g;
  let match: RegExpExecArray | null = literalPattern.exec(raw);
  while (match !== null) {
    const fragment = match[1]?.replace(/\\n/g, ' ').replace(/\\r/g, ' ');
    if (fragment && /[A-Za-zÄÖÜäöüß]{3,}/.test(fragment)) {
      chunks.push(fragment);
    }
    match = literalPattern.exec(raw);
  }
  return chunks.join(' ').slice(0, 16_000);
}
