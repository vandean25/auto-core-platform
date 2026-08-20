import type { ExecutionContext } from '@nestjs/common';
import type { ThrottlerOptions } from '@nestjs/throttler';
import type { Request } from 'express';

const AUTH_RATE_LIMIT_TTL = 60_000;

export const AUTH_ME_RATE_LIMIT = {
  limit: 120,
  ttl: AUTH_RATE_LIMIT_TTL,
} as const;

export const AUTH_SWITCH_TENANT_RATE_LIMIT = {
  limit: 10,
  ttl: AUTH_RATE_LIMIT_TTL,
} as const;

export function shouldThrottleAuthRoute(
  request: Pick<Request, 'method' | 'originalUrl' | 'url'>,
): boolean {
  const requestPath = (
    request.originalUrl ?? request.url ?? ''
  ).split('?')[0];
  const pathWithoutApiPrefix = requestPath.replace(/^\/api(?=\/|$)/, '');

  return (
    (request.method === 'GET' && pathWithoutApiPrefix === '/auth/me') ||
    (request.method === 'POST' &&
      pathWithoutApiPrefix === '/auth/switch-tenant')
  );
}

export const AUTH_THROTTLER_OPTIONS: ThrottlerOptions = {
  name: 'default',
  ...AUTH_ME_RATE_LIMIT,
  skipIf: (context: ExecutionContext): boolean => {
    const request = context.switchToHttp().getRequest<Request>();
    return !shouldThrottleAuthRoute(request);
  },
};
