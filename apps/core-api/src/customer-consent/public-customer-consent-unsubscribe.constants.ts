import type { ExecutionContext } from '@nestjs/common';
import type { ThrottlerOptions } from '@nestjs/throttler';
import type { Request } from 'express';

export const CONSENT_UNSUBSCRIBE_IP_THROTTLER = 'consent-unsubscribe-ip';

/** 32 random bytes in base64url → 43 characters. */
export const CONSENT_UNSUBSCRIBE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const UNSUBSCRIBE_ROUTE_SEGMENT = /[\\/]consent-unsubscribe[\\/]/i;

export function isPublicConsentUnsubscribeRequest(
  request: Pick<Request, 'originalUrl' | 'url'>,
): boolean {
  const target = request.originalUrl ?? request.url ?? '';
  return UNSUBSCRIBE_ROUTE_SEGMENT.test(target.split(/[?#]/, 1)[0]);
}

export const CONSENT_UNSUBSCRIBE_THROTTLER_OPTIONS: ThrottlerOptions = {
  name: CONSENT_UNSUBSCRIBE_IP_THROTTLER,
  limit: 120,
  ttl: 60_000,
  skipIf: (context: ExecutionContext): boolean =>
    !isPublicConsentUnsubscribeRequest(
      context.switchToHttp().getRequest<Request>(),
    ),
};
