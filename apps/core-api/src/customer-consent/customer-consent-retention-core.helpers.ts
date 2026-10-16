/** AUT-374 default: keep consent proof until withdrawal/unsubscribe + 3 calendar years (leap day clamps). */
export const CUSTOMER_CONSENT_PROOF_RETENTION_YEARS = 3;

export function addCalendarYearsPreservingDate(
  anchor: Date,
  years: number,
): Date {
  const month = anchor.getUTCMonth();
  const day = anchor.getUTCDate();
  const result = new Date(anchor.getTime());
  result.setUTCFullYear(result.getUTCFullYear() + years);
  if (result.getUTCMonth() !== month) {
    result.setUTCDate(0);
  } else {
    result.setUTCDate(day);
  }
  return result;
}

export function consentProofRetainUntil(cessationAt: Date): Date {
  return addCalendarYearsPreservingDate(
    cessationAt,
    CUSTOMER_CONSENT_PROOF_RETENTION_YEARS,
  );
}
