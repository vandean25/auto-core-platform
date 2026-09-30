/**
 * Structured HTTP error codes that are safe to return to API clients in
 * production even when the status is 5xx. These represent intentional,
 * operational gates — not unexpected internal failures.
 */
export const CLIENT_SAFE_HTTP_ERROR_CODES = new Set<string>([
  'INVOICE_BRANDING_WRITER_DISABLED',
  'BRAND_EXTRACTION_UNAVAILABLE',
]);

export function isClientSafeOperationalHttpError(
  responseBody: Record<string, unknown>,
): boolean {
  if (responseBody.operational === true) {
    return true;
  }
  const code = responseBody.code;
  return typeof code === 'string' && CLIENT_SAFE_HTTP_ERROR_CODES.has(code);
}
