import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { TenantContextStorage } from './tenant-context.storage';

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction) {
    TenantContextStorage.run(() => {
      // Reuse an inbound correlation ID or generate a server-side one.
      const requestId =
        (request.headers['x-request-id'] as string | undefined) ?? randomUUID();

      // Echo the effective request ID back to the caller.
      response.setHeader('x-request-id', requestId);

      // Prefer the leftmost address from X-Forwarded-For (set by load balancers).
      const forwarded = request.headers['x-forwarded-for'] as string | undefined;
      const ip = forwarded ? forwarded.split(',')[0].trim() : request.ip;
      const userAgent = request.headers['user-agent'];

      TenantContextStorage.setRequestMeta({
        requestId,
        source: 'API',
        ip,
        userAgent,
      });

      next();
    });
  }
}
