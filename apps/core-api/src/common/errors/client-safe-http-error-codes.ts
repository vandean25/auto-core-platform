/**
 * Structured HTTP error codes that are safe to return to API clients in
 * production even when the status is 5xx. These represent intentional,
 * operational gates — not unexpected internal failures.
 *
 * The warranty claim gates use 4xx statuses, but the global filter drops any
 * code missing from this set, so they are listed here too. Keep them in step
 * with WARRANTY_CLAIM_ERROR_CODES in warranty-claim.rules.ts.
 */
export const CLIENT_SAFE_HTTP_ERROR_CODES = new Set<string>([
  'INVOICE_BRANDING_WRITER_DISABLED',
  'BRAND_EXTRACTION_UNAVAILABLE',
  'DRY_RUN_NOT_SUPPORTED',
  'WARRANTY_CLAIM_ORDER_NOT_CHECKED_IN',
  'WARRANTY_CLAIM_CLOSED',
  'WARRANTY_CLAIM_LOCKED',
  'WARRANTY_CLAIM_INVALID_TRANSITION',
  'WARRANTY_CLAIM_SUBMISSION_INCOMPLETE',
  'WARRANTY_CLAIM_DECISION_DATE_REQUIRED',
  'WARRANTY_CLAIM_LINE_NOT_ON_ORDER',
  'WARRANTY_CLAIM_LINE_CANCELLED',
  'WARRANTY_CLAIM_LINE_ALREADY_CLAIMED',
  'WARRANTY_CLAIM_STATE_CHANGED',
]);

export function isClientSafeOperationalHttpError(
  responseBody: Record<string, unknown>,
): boolean {
  const code = responseBody.code;
  return typeof code === 'string' && CLIENT_SAFE_HTTP_ERROR_CODES.has(code);
}
