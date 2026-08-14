import {
  Injectable,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
  Logger,
  HttpException,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request, Response } from 'express';
import { TenantContextStorage } from '../services/tenant-context.storage';

export type HttpRequestLog = {
  type: 'http_request';
  requestId?: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  tenantId?: string;
  actorId?: string;
  ip?: string;
  userAgent?: string;
  errorName?: string;
};

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(HttpLoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();

    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          this.logCompletion(request, response, Date.now() - start);
        },
        error: (error: unknown) => {
          this.logError(request, response, error, Date.now() - start);
        },
      }),
    );
  }

  private logCompletion(
    request: Request,
    response: Response,
    durationMs: number,
  ): void {
    const user = TenantContextStorage.getUser();
    const requestMeta = TenantContextStorage.getRequestMeta();

    const statusCode = response?.statusCode ?? 200;
    const path = request?.originalUrl ?? request?.url ?? '/';
    const method = request?.method ?? 'GET';
    const requestId =
      requestMeta?.requestId ??
      (typeof request?.headers?.['x-request-id'] === 'string'
        ? request.headers['x-request-id']
        : undefined);
    const ip = requestMeta?.ip ?? request?.ip;
    const userAgent =
      requestMeta?.userAgent ??
      (typeof request?.headers?.['user-agent'] === 'string'
        ? request.headers['user-agent']
        : undefined);

    const payload: HttpRequestLog = {
      type: 'http_request',
      ...(requestId ? { requestId } : {}),
      method,
      path,
      statusCode,
      durationMs,
      ...(user?.tenantId ? { tenantId: user.tenantId } : {}),
      ...(user?.userId ? { actorId: user.userId } : {}),
      ...(ip ? { ip } : {}),
      ...(userAgent ? { userAgent } : {}),
    };

    if (statusCode >= 500) {
      this.logger.error(JSON.stringify(payload));
    } else if (statusCode >= 400) {
      this.logger.warn(JSON.stringify(payload));
    } else {
      this.logger.log(JSON.stringify(payload));
    }
  }

  private logError(
    request: Request,
    response: Response,
    error: unknown,
    durationMs: number,
  ): void {
    const user = TenantContextStorage.getUser();
    const requestMeta = TenantContextStorage.getRequestMeta();

    let statusCode = response?.statusCode ?? 500;
    if (error instanceof HttpException) {
      statusCode = error.getStatus();
    } else if (statusCode < 400) {
      statusCode = 500;
    }

    const path = request?.originalUrl ?? request?.url ?? '/';
    const method = request?.method ?? 'GET';
    const requestId =
      requestMeta?.requestId ??
      (typeof request?.headers?.['x-request-id'] === 'string'
        ? request.headers['x-request-id']
        : undefined);
    const ip = requestMeta?.ip ?? request?.ip;
    const userAgent =
      requestMeta?.userAgent ??
      (typeof request?.headers?.['user-agent'] === 'string'
        ? request.headers['user-agent']
        : undefined);
    const errorName =
      error instanceof Error ? error.constructor.name : 'UnknownError';

    const payload: HttpRequestLog = {
      type: 'http_request',
      ...(requestId ? { requestId } : {}),
      method,
      path,
      statusCode,
      durationMs,
      errorName,
      ...(user?.tenantId ? { tenantId: user.tenantId } : {}),
      ...(user?.userId ? { actorId: user.userId } : {}),
      ...(ip ? { ip } : {}),
      ...(userAgent ? { userAgent } : {}),
    };

    if (statusCode >= 500) {
      this.logger.error(JSON.stringify(payload));
    } else {
      this.logger.warn(JSON.stringify(payload));
    }
  }
}
