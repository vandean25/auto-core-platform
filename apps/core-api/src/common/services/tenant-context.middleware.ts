import {
  BadRequestException,
  Injectable,
  type NestMiddleware,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { TenantContextStorage } from './tenant-context.storage.js';
import { isTraceIdUuid } from './trace-id.util.js';

function getNormalizedHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    return value.map((entry) => entry.trim()).find((entry) => entry.length > 0);
  }

  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction) {
    TenantContextStorage.run(() => {
      // Reuse an inbound correlation ID or generate a server-side one.
      const requestId =
        getNormalizedHeaderValue(request.headers['x-request-id']) ??
        randomUUID();

      const inboundTraceId = getNormalizedHeaderValue(
        request.headers['x-trace-id'],
      );
      if (inboundTraceId !== undefined && !isTraceIdUuid(inboundTraceId)) {
        throw new BadRequestException('X-Trace-Id must be a valid UUID');
      }
      const traceId = inboundTraceId ?? randomUUID();

      // Echo the effective request ID back to the caller.
      response.setHeader('x-request-id', requestId);
      response.setHeader('x-trace-id', traceId);

      const ip = request.ip;
      const userAgent = getNormalizedHeaderValue(request.headers['user-agent']);

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
