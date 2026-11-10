const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidV7(value: string): boolean {
  return UUID_V7_PATTERN.test(value);
}

/** Parses the 48-bit unix-ms timestamp embedded in a UUIDv7. */
export function uuidV7TimestampMillis(key: string): number | null {
  const hex = key.replace(/-/g, '').toLowerCase();
  if (!UUID_V7_PATTERN.test(key) || hex.length !== 32) {
    return null;
  }
  const ts = BigInt(`0x${hex.slice(0, 12)}`);
  if (ts > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  return Number(ts);
}
