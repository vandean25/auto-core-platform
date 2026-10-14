import type { ExecutionContext } from '@nestjs/common';
import type { ThrottlerOptions } from '@nestjs/throttler';
import type { Request } from 'express';

/** Named throttler for the public route (per IP). Its limits per route are set with @Throttle. */
export const ESTIMATE_APPROVAL_IP_THROTTLER = 'estimate-approval-ip';

/**
 * A raw token is 32 random bytes in base64url, so it is 43 characters from this alphabet. Anything else is
 * answered as not found without a database read.
 */
export const ESTIMATE_APPROVAL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// Express routes paths case-insensitively by default, so the prefix match has to be case-insensitive too.
const PUBLIC_ESTIMATE_APPROVAL_PATH = /^\/api\/public\/estimate-approvals\//i;

export function isPublicEstimateApprovalRequest(
  request: Pick<Request, 'originalUrl' | 'url'>,
): boolean {
  const path = (request.originalUrl ?? request.url ?? '').split('?')[0];
  return PUBLIC_ESTIMATE_APPROVAL_PATH.test(path);
}

export const ESTIMATE_APPROVAL_THROTTLER_OPTIONS: ThrottlerOptions = {
  name: ESTIMATE_APPROVAL_IP_THROTTLER,
  limit: 120,
  ttl: 60_000,
  skipIf: (context: ExecutionContext): boolean =>
    !isPublicEstimateApprovalRequest(
      context.switchToHttp().getRequest<Request>(),
    ),
};

/** Per-token limits, applied per process (see the limiter). Windows are ten minutes. */
export const ESTIMATE_APPROVAL_TOKEN_READ_LIMIT = 60;
export const ESTIMATE_APPROVAL_TOKEN_DECISION_LIMIT = 10;
export const ESTIMATE_APPROVAL_TOKEN_WINDOW_MS = 10 * 60_000;

/** Generic answers: the page never says whether a link was unknown, expired or used. German, Sie-form. */
export const ESTIMATE_APPROVAL_ERRORS = {
  notFound: {
    code: 'ESTIMATE_APPROVAL_NOT_FOUND',
    message: 'Dieser Link ist nicht gültig.',
  },
  unavailable: {
    code: 'ESTIMATE_APPROVAL_UNAVAILABLE',
    message: 'Dieser Link ist abgelaufen oder wurde bereits verwendet.',
  },
  notDecidable: {
    code: 'ESTIMATE_NOT_DECIDABLE',
    message:
      'Dieser Kostenvoranschlag kann nicht mehr angenommen oder abgelehnt werden.',
  },
  incomplete: {
    code: 'ESTIMATE_APPROVAL_CONFIRMATION_INCOMPLETE',
    message:
      'Bitte bestätigen Sie die Hinweise und die Erklärung und geben Sie Ihren vollständigen Namen an.',
  },
  rateLimited: {
    code: 'ESTIMATE_APPROVAL_RATE_LIMITED',
    message: 'Zu viele Anfragen. Bitte versuchen Sie es später erneut.',
  },
} as const;
