/** Integer money/qty math for migration reconciliation (half-up, no float drift). */

const MONEY_PATTERN = /^(0|[1-9][0-9]{0,17})\.(\d{2})$/;
const SIGNED_MONEY_PATTERN = /^-?(0|[1-9][0-9]{0,17})\.(\d{2})$/;

export function isCanonicalMoneyString(value: string): boolean {
  return MONEY_PATTERN.test(value);
}

export function isCanonicalSignedMoneyString(value: string): boolean {
  return SIGNED_MONEY_PATTERN.test(value) && value !== '-0.00';
}

export function coerceManifestMoneyString(
  value: unknown,
): { ok: true; text: string } | { ok: false } {
  if (typeof value === 'string') {
    return isCanonicalMoneyString(value) || isCanonicalSignedMoneyString(value)
      ? { ok: true, text: value }
      : { ok: false };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const text = value.toFixed(2);
    return isCanonicalMoneyString(text) || isCanonicalSignedMoneyString(text)
      ? { ok: true, text }
      : { ok: false };
  }
  return { ok: false };
}

export function tryParseMoneyToCents(value: string): bigint | null {
  try {
    return parseMoneyToCents(value);
  } catch {
    return null;
  }
}

export function parseMoneyToCents(value: string): bigint {
  const negative = value.startsWith('-');
  const normalized = negative ? value.slice(1) : value;
  const match = MONEY_PATTERN.exec(normalized);
  if (!match) {
    throw new Error(`invalid money: ${value}`);
  }
  const cents = BigInt(match[1]) * 100n + BigInt(match[2]);
  return negative ? -cents : cents;
}

export function formatMoneyFromCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const frac = abs % 100n;
  const body = `${whole.toString()}.${frac.toString().padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}

export function formatSignedMoneyFromCents(cents: bigint): string {
  return formatMoneyFromCents(cents);
}

export function parseQtyToMillis(value: string): bigint {
  const match = /^(0|[1-9][0-9]{0,7})\.(\d{3})$/.exec(value);
  if (!match) {
    throw new Error(`invalid qty: ${value}`);
  }
  return BigInt(match[1]) * 1000n + BigInt(match[2]);
}

/** Half-up: line net cents from qty (3dp) × unit cost (money). */
export function lineMoneyCentsFromQtyAndUnit(
  quantity: string,
  unitCost: string,
): bigint {
  const qtyMillis = parseQtyToMillis(quantity);
  const unitCents = parseMoneyToCents(unitCost);
  const product = qtyMillis * unitCents;
  return (product + 500n) / 1000n;
}

export function sumMoneyStrings(values: string[]): string {
  let total = 0n;
  for (const value of values) {
    const cents = tryParseMoneyToCents(value);
    if (cents === null) {
      throw new Error(`invalid money: ${value}`);
    }
    total += cents;
  }
  return formatMoneyFromCents(total);
}

export function moneyStringsEqual(left: string, right: string): boolean {
  const leftCents = tryParseMoneyToCents(left);
  const rightCents = tryParseMoneyToCents(right);
  if (leftCents === null || rightCents === null) {
    return false;
  }
  return leftCents === rightCents;
}

export function addMoneyStrings(net: string, vat: string): string {
  const netCents = tryParseMoneyToCents(net);
  const vatCents = tryParseMoneyToCents(vat);
  if (netCents === null || vatCents === null) {
    throw new Error('invalid money in addMoneyStrings');
  }
  return formatMoneyFromCents(netCents + vatCents);
}
