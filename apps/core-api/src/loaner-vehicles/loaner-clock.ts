let loanerNowOverride: (() => Date) | undefined;

export function getLoanerNow(): Date {
  return loanerNowOverride ? loanerNowOverride() : new Date();
}

/** Test-only hook; not for production use. */
export function setLoanerNowForTests(
  now: Date | (() => Date) | undefined,
): void {
  if (now === undefined) {
    loanerNowOverride = undefined;
    return;
  }
  loanerNowOverride = typeof now === 'function' ? now : () => now;
}
