/** Wire codes attached when no domain-specific `code` is present on an HTTP error body. */
export const HTTP_STATUS_FALLBACK_CODES: Record<number, string> = {
  400: 'HTTP_400',
  401: 'HTTP_401',
  403: 'HTTP_403',
  404: 'HTTP_404',
  409: 'HTTP_409',
  413: 'HTTP_413',
  415: 'HTTP_415',
  422: 'HTTP_422',
  429: 'HTTP_429',
  500: 'HTTP_500',
  502: 'HTTP_502',
  503: 'HTTP_503',
  504: 'HTTP_504',
};

export const PRISMA_REQUEST_ERROR_CODES: Record<string, string> = {
  P2000: 'PRISMA_P2000',
  P2002: 'PRISMA_P2002',
  P2003: 'PRISMA_P2003',
  P2025: 'PRISMA_P2025',
};

export function resolveHttpStatusFallbackCode(status: number): string {
  const mapped = HTTP_STATUS_FALLBACK_CODES[status];
  if (mapped) {
    return mapped;
  }
  if (status >= 400 && status < 500) {
    return 'HTTP_4XX';
  }
  return 'HTTP_500';
}
