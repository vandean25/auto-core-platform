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
  'API_KEYS_NOT_CONFIGURED',
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
  'NOT_A_CATALOG_LINE',
  // A 409 the workshop intake dialog turns into an "Open <order>" link. The filter drops `code` without this entry.
  'VEHICLE_HAS_ACTIVE_ORDER',
  // Public estimate approval link (ADR-0025 §7). The page maps these codes to German copy.
  'ESTIMATE_APPROVAL_NOT_FOUND',
  'ESTIMATE_APPROVAL_UNAVAILABLE',
  'ESTIMATE_NOT_DECIDABLE',
  'ESTIMATE_APPROVAL_CONFIRMATION_INCOMPLETE',
  'ESTIMATE_APPROVAL_RATE_LIMITED',
  // Advisor estimate send gates (ADR-0025 §6 and §8). The send dialog maps these codes.
  'ESTIMATE_SEND_DISABLED',
  'ESTIMATE_APPROVAL_LINK_UNAVAILABLE',
  'ESTIMATE_CUSTOMER_EMAIL_NOT_CONFIRMED',
  'ESTIMATE_CUSTOMER_EMAIL_MISSING',
  'ESTIMATE_CUSTOMER_EMAIL_INVALID',
  'ESTIMATE_VEHICLE_INCOMPLETE',
  'ESTIMATE_EMAIL_INCOMPLETE',
]);

/**
 * Body fields, beyond `code` and `message`, that the global filter forwards for a client-safe code. Only IDs and
 * order numbers belong here, and a field is forwarded only when its value is a string.
 */
export const CLIENT_SAFE_HTTP_ERROR_DETAIL_KEYS: Partial<
  Record<string, readonly string[]>
> = {
  VEHICLE_HAS_ACTIVE_ORDER: ['orderId', 'orderNumber'],
};

export function isClientSafeOperationalHttpError(
  responseBody: Record<string, unknown>,
): boolean {
  const code = responseBody.code;
  return typeof code === 'string' && CLIENT_SAFE_HTTP_ERROR_CODES.has(code);
}

export function pickClientSafeHttpErrorDetails(
  responseBody: Record<string, unknown>,
): Record<string, string> {
  const code = responseBody.code;
  if (typeof code !== 'string' || !CLIENT_SAFE_HTTP_ERROR_CODES.has(code)) {
    return {};
  }

  const details: Record<string, string> = {};
  for (const key of CLIENT_SAFE_HTTP_ERROR_DETAIL_KEYS[code] ?? []) {
    const value = responseBody[key];
    if (typeof value === 'string') details[key] = value;
  }
  return details;
}
