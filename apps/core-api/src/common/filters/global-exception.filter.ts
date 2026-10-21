import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/node';
import type { Request, Response } from 'express';
import { applyPdfDownloadCacheControlIfNeeded } from '../pdf/pdf-download-cache.js';
import {
  ApplicationError,
  ConflictError,
  NotFoundError,
  BadRequestError,
  ValidationError,
} from '../errors/application-errors.js';
import {
  isClientSafeOperationalHttpError,
  pickClientSafeHttpErrorDetails,
  pickClientSafeHttpErrorParams,
  pickClientSafeHttpErrorStructuredDetails,
} from '../errors/client-safe-http-error-codes.js';
import { TenantContextStorage } from '../services/tenant-context.storage.js';
import {
  PRISMA_REQUEST_ERROR_CODES,
  resolveHttpStatusFallbackCode,
} from '../errors/http-status-error-codes.js';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

type ResolvedError = {
  status: number;
  message: string | string[];
  error?: string;
  code?: string;
  details?: Record<string, string>;
  params?: Record<string, string>;
  structuredDetails?: Record<string, unknown>;
};

type ErrorRequestContext = {
  requestId?: string;
  tenantId?: string;
  actorId?: string;
};

/** The allowlisted extras a client may see for an operational error. Empty for any other body. */
function pickClientSafeFields(
  safeBody: Record<string, unknown> | undefined,
): Pick<ResolvedError, 'details' | 'params' | 'structuredDetails'> {
  if (!safeBody) {
    return { details: {}, params: {}, structuredDetails: {} };
  }
  return {
    details: pickClientSafeHttpErrorDetails(safeBody),
    params: pickClientSafeHttpErrorParams(safeBody),
    structuredDetails: pickClientSafeHttpErrorStructuredDetails(safeBody),
  };
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const user = TenantContextStorage.getUser();
    const requestMeta = TenantContextStorage.getRequestMeta();
    const context: ErrorRequestContext = {
      requestId: requestMeta?.requestId,
      tenantId: user?.tenantId,
      actorId: user?.userId,
    };

    const resolved = this.resolveException(exception, context);
    const eventId = this.captureSentryIfInternal(exception, resolved.status);

    applyPdfDownloadCacheControlIfNeeded(request, response);

    response.status(resolved.status).json({
      statusCode: resolved.status,
      message: resolved.message,
      error: resolved.error || this.getHttpStatusName(resolved.status),
      ...(resolved.code ? { code: resolved.code } : {}),
      ...(resolved.details ?? {}),
      ...(resolved.params && Object.keys(resolved.params).length > 0
        ? { params: resolved.params }
        : {}),
      ...(resolved.structuredDetails ?? {}),
      ...(eventId ? { eventId } : {}),
      // The x-request-id the request was logged under, so a user can quote it to support.
      ...(resolved.status >= 500 && context.requestId
        ? { requestId: context.requestId }
        : {}),
    });
  }

  private resolveException(
    exception: unknown,
    context: ErrorRequestContext,
  ): ResolvedError {
    if (exception instanceof HttpException) {
      return this.handleHttpException(exception, context);
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.handlePrismaError(exception, context);
    }
    if (exception instanceof ApplicationError) {
      return this.handleApplicationError(exception);
    }
    if (exception instanceof Error) {
      return this.handleGenericError(exception, context);
    }
    return this.handleUnknownError(exception, context);
  }

  private handleHttpException(
    exception: HttpException,
    context: ErrorRequestContext,
  ): ResolvedError {
    const status = exception.getStatus();
    const responseBody = exception.getResponse();
    const body = isRecord(responseBody) ? responseBody : undefined;
    const responseCode = typeof body?.code === 'string' ? body.code : undefined;
    // Only an allowlisted code makes the body safe to forward in production.
    const safeBody =
      body && isClientSafeOperationalHttpError(body) ? body : undefined;
    const isProductionServerError =
      status >= 500 && process.env.NODE_ENV === 'production';

    if (isProductionServerError) {
      this.logProductionHttpError(
        exception,
        responseCode,
        context,
        safeBody !== undefined,
      );
    }

    const isMasked = isProductionServerError && !safeBody;
    return {
      status,
      message: isMasked
        ? this.serverErrorMessage(context.requestId)
        : (body?.message as string | string[]) || exception.message,
      error: body?.error as string | undefined,
      code: (safeBody && responseCode) || resolveHttpStatusFallbackCode(status),
      ...pickClientSafeFields(safeBody),
    };
  }

  /** A client-safe 5xx is an operational gate (warn, no stack); any other one is an unexpected failure (error + stack). */
  private logProductionHttpError(
    exception: HttpException,
    responseCode: string | undefined,
    context: ErrorRequestContext,
    isClientSafe: boolean,
  ): void {
    const logPayload = JSON.stringify({
      type: 'http_error',
      ...(context.requestId ? { requestId: context.requestId } : {}),
      statusCode: exception.getStatus(),
      errorName: exception.constructor.name,
      message: exception.message,
      ...(responseCode ? { code: responseCode } : {}),
      ...(context.tenantId ? { tenantId: context.tenantId } : {}),
      ...(context.actorId ? { actorId: context.actorId } : {}),
    });
    if (isClientSafe) {
      this.logger.warn(logPayload);
    } else {
      this.logger.error(logPayload, exception.stack);
    }
  }

  private handlePrismaError(
    exception: Prisma.PrismaClientKnownRequestError,
    context: ErrorRequestContext,
  ): ResolvedError {
    const logPayload = {
      type: 'prisma_error',
      ...(context.requestId ? { requestId: context.requestId } : {}),
      code: exception.code,
      meta: exception.meta ?? {},
      ...(context.tenantId ? { tenantId: context.tenantId } : {}),
      ...(context.actorId ? { actorId: context.actorId } : {}),
    };
    this.logger.error(JSON.stringify(logPayload));

    switch (exception.code) {
      case 'P2000':
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'The provided value is too long for one of the columns.',
          code: PRISMA_REQUEST_ERROR_CODES.P2000,
        };
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          message: 'A record with this value already exists.',
          code: PRISMA_REQUEST_ERROR_CODES.P2002,
        };
      case 'P2003':
        return {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          message:
            'This operation cannot be completed because of a related record.',
          code: PRISMA_REQUEST_ERROR_CODES.P2003,
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          message: 'The requested record was not found.',
          code: PRISMA_REQUEST_ERROR_CODES.P2025,
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'An unexpected database error occurred.',
          code: resolveHttpStatusFallbackCode(HttpStatus.INTERNAL_SERVER_ERROR),
        };
    }
  }

  private handleApplicationError(exception: ApplicationError): ResolvedError {
    let status: number = HttpStatus.BAD_REQUEST;
    if (exception instanceof ConflictError) {
      status = HttpStatus.CONFLICT;
    } else if (exception instanceof NotFoundError) {
      status = HttpStatus.NOT_FOUND;
    } else if (
      exception instanceof BadRequestError ||
      exception instanceof ValidationError
    ) {
      status = HttpStatus.BAD_REQUEST;
    }
    return {
      status,
      message: exception.message,
      code: resolveHttpStatusFallbackCode(status),
    };
  }

  private handleGenericError(
    exception: Error,
    context: ErrorRequestContext,
  ): ResolvedError {
    const logPayload = {
      type: 'http_error',
      ...(context.requestId ? { requestId: context.requestId } : {}),
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      errorName: exception.constructor.name,
      message: exception.message,
      ...(context.tenantId ? { tenantId: context.tenantId } : {}),
      ...(context.actorId ? { actorId: context.actorId } : {}),
    };
    this.logger.error(JSON.stringify(logPayload), exception.stack);

    const message =
      process.env.NODE_ENV === 'production'
        ? this.serverErrorMessage(context.requestId)
        : exception.message;
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message,
      code: resolveHttpStatusFallbackCode(HttpStatus.INTERNAL_SERVER_ERROR),
    };
  }

  private handleUnknownError(
    exception: unknown,
    context: ErrorRequestContext,
  ): ResolvedError {
    const logPayload = {
      type: 'unknown_error',
      ...(context.requestId ? { requestId: context.requestId } : {}),
      error: String(exception),
      ...(context.tenantId ? { tenantId: context.tenantId } : {}),
      ...(context.actorId ? { actorId: context.actorId } : {}),
    };
    this.logger.error(JSON.stringify(logPayload));
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: this.serverErrorMessage(context.requestId),
      code: resolveHttpStatusFallbackCode(HttpStatus.INTERNAL_SERVER_ERROR),
    };
  }

  /** The message for a masked 5xx. It names the request id so the user can quote it to support. */
  private serverErrorMessage(requestId?: string): string {
    return requestId
      ? `Something went wrong (ref: ${requestId})`
      : 'Something went wrong';
  }

  private captureSentryIfInternal(
    exception: unknown,
    status: number,
  ): string | undefined {
    if (status < 500) {
      return undefined;
    }
    try {
      const captured = Sentry.captureException(exception);
      return captured || undefined;
    } catch {
      return undefined;
    }
  }

  private getHttpStatusName(status: number): string {
    // Map common status codes to human-readable strings to match NestJS defaults
    switch (status) {
      case 400:
        return 'Bad Request';
      case 401:
        return 'Unauthorized';
      case 403:
        return 'Forbidden';
      case 404:
        return 'Not Found';
      case 409:
        return 'Conflict';
      case 422:
        return 'Unprocessable Entity';
      case 500:
        return 'Internal Server Error';
      default:
        return HttpStatus[status] || 'Error';
    }
  }
}
