import { guardedRequestInvalid } from './guarded-price.errors.js';

const MAX_MINOR = 9_999_999_999n;

export function retailMajorToMinorUnits(retailPrice: number): bigint {
  if (!Number.isFinite(retailPrice) || retailPrice < 0) {
    guardedRequestInvalid('retail_price must be a non-negative number.');
  }
  const text = /e/i.test(retailPrice.toString())
    ? retailPrice.toFixed(2)
    : retailPrice.toString();
  return convertMajorTextToMinor(text);
}

function convertMajorTextToMinor(text: string): bigint {
  const match = /^(-?\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) {
    guardedRequestInvalid('retail_price is not a valid major-unit amount.');
  }
  const fraction = match[2] ?? '';
  if (fraction.length > 2) {
    guardedRequestInvalid('retail_price has more than two decimal places.');
  }
  const sign = text.startsWith('-') ? -1n : 1n;
  const whole = BigInt(match[1].replace(/^-/, ''));
  const fractionPadded = `${fraction}${'0'.repeat(Math.max(0, 2 - fraction.length))}`;
  const minor = whole * 100n + (fractionPadded ? BigInt(fractionPadded) : 0n);
  const signed = sign * minor;
  if (signed < 0n || signed > MAX_MINOR) {
    guardedRequestInvalid('retail_price is out of allowed range.');
  }
  return signed;
}

export function minorUnitsToDecimalString(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = abs / 100n;
  const frac = abs % 100n;
  const fracText = frac.toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fracText}`;
}
