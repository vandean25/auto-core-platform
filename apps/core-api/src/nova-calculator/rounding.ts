/** Whole percent per NoVAG § 6 (kaufmännisch / half-up for non-negative rates). */
export function roundToWholePercent(rawRate: number): number {
  if (!Number.isFinite(rawRate)) {
    return 0;
  }
  return Math.round(rawRate);
}

/** Monetary result to two decimal places (half-up). */
export function roundMoneyEuro(amount: number): number {
  if (!Number.isFinite(amount)) {
    return 0;
  }
  return Math.round(amount * 100) / 100;
}
