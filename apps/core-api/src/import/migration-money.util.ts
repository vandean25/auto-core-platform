/** Integer money/qty math for migration reconciliation (half-up, no float drift). */

export function parseMoneyToCents(value: string): bigint {
  const negative = value.startsWith('-');
  const normalized = negative ? value.slice(1) : value;
  const match = /^(0|[1-9][0-9]{0,17})\.(\d{2})$/.exec(normalized);
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
    total += parseMoneyToCents(value);
  }
  return formatMoneyFromCents(total);
}

export function moneyStringsEqual(left: string, right: string): boolean {
  return parseMoneyToCents(left) === parseMoneyToCents(right);
}

export function addMoneyStrings(net: string, vat: string): string {
  return formatMoneyFromCents(parseMoneyToCents(net) + parseMoneyToCents(vat));
}
