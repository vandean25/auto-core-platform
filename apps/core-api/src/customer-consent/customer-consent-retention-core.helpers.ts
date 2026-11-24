/** AUT-374 default (AT): keep consent proof until withdrawal/unsubscribe + 3 calendar years (leap day clamps). */
export const CUSTOMER_CONSENT_PROOF_RETENTION_YEARS = 3;

/** AUT-1041 (§ 7a UWG, DE): keep consent proof 5 years after last use / withdrawal. */
export const CUSTOMER_CONSENT_PROOF_RETENTION_YEARS_DE = 5;

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

export function consentProofRetainUntil(
  cessationAt: Date,
  countryIso?: string | null,
): Date {
  const years =
    countryIso === 'DE'
      ? CUSTOMER_CONSENT_PROOF_RETENTION_YEARS_DE
      : CUSTOMER_CONSENT_PROOF_RETENTION_YEARS;
  return addCalendarYearsPreservingDate(cessationAt, years);
}
