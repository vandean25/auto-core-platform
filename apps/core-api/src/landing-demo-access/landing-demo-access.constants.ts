import type { ExecutionContext } from '@nestjs/common';
import type { ThrottlerOptions } from '@nestjs/throttler';
import type { Request } from 'express';

export const LANDING_DEMO_IP_THROTTLER = 'landing-demo-ip';

const LANDING_DEMO_ROUTE_SEGMENT = /[\\/]public[\\/]landing-demo[\\/]access/i;

export function isLandingDemoAccessRequest(
  request: Pick<Request, 'originalUrl' | 'url'>,
): boolean {
  const target = request.originalUrl ?? request.url ?? '';
  return LANDING_DEMO_ROUTE_SEGMENT.test(target.split(/[?#]/, 1)[0]);
}

export const LANDING_DEMO_THROTTLER_OPTIONS: ThrottlerOptions = {
  name: LANDING_DEMO_IP_THROTTLER,
  limit: 30,
  ttl: 60_000,
  skipIf: (context: ExecutionContext): boolean =>
    !isLandingDemoAccessRequest(
      context.switchToHttp().getRequest<Request>(),
    ),
};
