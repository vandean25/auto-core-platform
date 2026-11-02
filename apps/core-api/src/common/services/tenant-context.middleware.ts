import {
  BadRequestException,
  Injectable,
  type NestMiddleware,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { TenantContextStorage } from './tenant-context.storage.js';
import { linkAppTraceIdToSentry } from '../observability/trace.js';
import { isTraceIdUuid } from './trace-id.util.js';
import {
  firstNonEmptyHeaderValue,
  resolveRequestId,
} from '../utils/request-id.util.js';

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction) {
    TenantContextStorage.run(() => {
      // Reuse a valid inbound correlation ID or generate a server-side one.
      const requestId = resolveRequestId(request.headers['x-request-id']);

      const inboundTraceId = firstNonEmptyHeaderValue(
        request.headers['x-trace-id'],
      );
      if (inboundTraceId !== undefined && !isTraceIdUuid(inboundTraceId)) {
        throw new BadRequestException('X-Trace-Id must be a valid UUID');
      }
      const traceId = inboundTraceId ?? randomUUID();
      linkAppTraceIdToSentry(traceId);

      // Echo the effective request ID back to the caller.
      response.setHeader('x-request-id', requestId);
      response.setHeader('x-trace-id', traceId);

      const ip = request.ip;
      const userAgent = firstNonEmptyHeaderValue(request.headers['user-agent']);

      TenantContextStorage.setRequestMeta({
        requestId,
        traceId,
        source: 'API',
        ip,
        userAgent,
      });

      next();
    });
  }
}
