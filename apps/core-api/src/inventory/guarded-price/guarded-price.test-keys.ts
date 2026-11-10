/** Builds a UUIDv7-shaped key whose embedded timestamp is `ms` (for e2e/tests). */
export function testUuidV7At(ms: number): string {
  const tsHex = ms.toString(16).padStart(12, '0');
  return `${tsHex.slice(0, 8)}-${tsHex.slice(8, 12)}-7000-8000-000000000001`;
}
