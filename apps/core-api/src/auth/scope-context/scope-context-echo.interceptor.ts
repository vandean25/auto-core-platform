import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { type Observable, map } from 'rxjs';
import {
  getHttpRequestResponse,
  passthroughUnlessHttpContext,
} from '../../common/nest/http-execution-context.js';
import { SCOPE_CONTEXT_HEADER } from './scope-context.constants.js';
import { ScopeContextService } from './scope-context.service.js';

const ECHO_PATHS = new Set([
  '/api/inventory',
  '/api/inventory/capped-count',
  '/api/sales/invoices',
  '/api/sales/invoices/capped-count',
  '/api/vehicle-stock',
  '/api/vehicle-stock/capped-count',
]);

function normalizePath(request: Request): string {
  const path =
    request.path ??
    request.url?.split('?')[0] ??
    request.originalUrl?.split('?')[0] ??
    '';
  return path.startsWith('/api/')
    ? path
    : `/api${path.startsWith('/') ? '' : '/'}${path}`;
}

@Injectable()
export class ScopeContextEchoInterceptor implements NestInterceptor {
  constructor(private readonly scopeContext: ScopeContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const nonHttp = passthroughUnlessHttpContext(context, next);
    if (nonHttp) {
      return nonHttp;
    }

    const { request, response } = getHttpRequestResponse(context);
    const path = normalizePath(request);

    if (request.method !== 'GET' || !ECHO_PATHS.has(path)) {
      return next.handle();
    }

    if (
      path === '/api/inventory' ||
      path === '/api/sales/invoices' ||
      path === '/api/vehicle-stock'
    ) {
      const pagination = request.query.pagination;
      const cursor = request.query.cursor;
      const useCursor = pagination === 'cursor' || Boolean(cursor);
      if (!useCursor) {
        return next.handle();
      }
    }

    const headerValue = readHeader(request, SCOPE_CONTEXT_HEADER);
    const digest = this.scopeContext.tryEchoScopeContextDigest(headerValue);

    return next.handle().pipe(
      map((body: unknown): unknown => {
        response.setHeader('Cache-Control', 'private, no-store');
        if (!digest || !isRecord(body)) {
          return body;
        }
        if ('meta' in body && isRecord(body.meta)) {
          return {
            ...body,
            meta: { ...body.meta, scopeContextDigest: digest },
          };
        }
        return { ...body, scopeContextDigest: digest };
      }),
    );
  }
}

function readHeader(request: Request, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
