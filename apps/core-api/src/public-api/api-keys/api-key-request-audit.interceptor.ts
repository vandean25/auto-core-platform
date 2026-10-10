import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { from, Observable, catchError, map, switchMap, throwError } from 'rxjs';
import { PUBLIC_API_SCOPE_KEY } from '../decorators/require-public-api-scope.decorator.js';
import type { PublicApiScope } from '../public-api-scopes.js';
import type { ApiKeyRequest } from './api-key.guard.js';
import {
  ApiKeyRequestAuditService,
  describeApiKeyRoute,
  outcomeForHttpStatus,
} from './api-key-request-audit.service.js';

/**
 * Audits API-key requests that reached a handler, using the real response status. Requests refused by
 * ApiKeyAuthGuard are audited there. Session requests pass through untouched.
 */
@Injectable()
export class ApiKeyRequestAuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: ApiKeyRequestAuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<ApiKeyRequest>();
    const principal = request.apiKeyPrincipal;
    if (!principal) {
      return next.handle();
    }

    const scope =
      this.reflector.getAllAndOverride<PublicApiScope | undefined>(
        PUBLIC_API_SCOPE_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? null;
    const route = describeApiKeyRoute(request);
    const record = (httpStatus: number) =>
      this.audit.record({
        principal,
        method: request.method,
        route,
        scope,
        httpStatus,
        outcome: outcomeForHttpStatus(httpStatus),
      });

    return next.handle().pipe(
      catchError((error: unknown) =>
        from(record(statusOf(error))).pipe(
          switchMap(() => throwError(() => error)),
        ),
      ),
      switchMap((value: unknown) =>
        from(record(http.getResponse<Response>().statusCode)).pipe(
          map(() => value),
        ),
      ),
    );
  }
}

function statusOf(error: unknown): number {
  return error instanceof HttpException ? error.getStatus() : 500;
}
