/** Mirrors `apps/core-api/src/common/errors/http-status-error-codes.ts` for the web client. */
export const HTTP_STATUS_FALLBACK_CODES: Record<number, string> = {
  400: 'HTTP_400',
  401: 'HTTP_401',
  403: 'HTTP_403',
  404: 'HTTP_404',
  409: 'HTTP_409',
  422: 'HTTP_422',
  429: 'HTTP_429',
  500: 'HTTP_500',
  502: 'HTTP_502',
  503: 'HTTP_503',
  504: 'HTTP_504',
}

export function wireCodeForHttpStatus(status: number): string {
  return HTTP_STATUS_FALLBACK_CODES[status] ?? 'HTTP_500'
}
