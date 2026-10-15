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
  // Vehicle sale warranty 422s. The sale form shows the message inline on the Verkürzung checkbox.
  'GEWAEHRLEISTUNG_FIRST_REGISTRATION_REQUIRED',
  'GEWAEHRLEISTUNG_SHORTENING_VEHICLE_TOO_NEW',
  'GEWAEHRLEISTUNG_SHORTENING_REQUIRES_CONSUMER',
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
  // Estimate send gates from before the email send, and the order and role gates a send can hit. The send dialog
  // maps these codes too.
  'ESTIMATE_NOT_DRAFT',
  'ESTIMATE_NO_LINES',
  'ESTIMATE_CUSTOMER_REQUIRED',
  'ESTIMATE_CUSTOMER_INCOMPLETE',
  'SELLER_IDENTITY_INCOMPLETE',
  'WORKSHOP_ORDER_NOT_ESTIMATABLE',
  'ESTIMATE_ROLE_FORBIDDEN',
  'REGISTRATION_EXTRACTION_UNAVAILABLE',
  'REGISTRATION_INTAKE_IDEMPOTENCY_KEY_INVALID',
  'REGISTRATION_INTAKE_IDEMPOTENCY_CONFLICT',
  'REGISTRATION_INTAKE_IN_PROGRESS',
  'REGISTRATION_INTAKE_UNSUPPORTED_FILE',
  'REGISTRATION_INTAKE_STORE_FAILED',
  'REGISTRATION_INTAKE_TOO_MANY_FILES',
  'REGISTRATION_INTAKE_FILE_TOO_LARGE',
  'REGISTRATION_INTAKE_ID_MISMATCH',
  'REGISTRATION_INTAKE_LOW_CONFIDENCE',
  'REGISTRATION_INTAKE_VEHICLE_IDENTITY_INCOMPLETE',
  'REGISTRATION_INTAKE_CONFIRMATION_MISMATCH',
  'REGISTRATION_INTAKE_WRONG_DOCUMENT',
  'REGISTRATION_INTAKE_ILLEGIBLE',
  'REGISTRATION_INTAKE_CONFLICTING_VIN',
  'REGISTRATION_INTAKE_INVALID_VIN',
  'REGISTRATION_INTAKE_NATIONALCODE_LOOKS_LIKE_VIN',
  'REGISTRATION_INTAKE_AMBIGUOUS_MATCH',
  'REGISTRATION_INTAKE_OWNERSHIP_CONFLICT',
  'REGISTRATION_INTAKE_FIELD_CONFLICT',
  'REGISTRATION_INTAKE_STATE_CHANGED',
  'REGISTRATION_INTAKE_BYTES_REMAIN',
  'REGISTRATION_INTAKE_APPLIED',
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
