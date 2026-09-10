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
import type { Response } from 'express';
import {
  ApplicationError,
  ConflictError,
  NotFoundError,
  BadRequestError,
  ValidationError,
} from '../errors/application-errors';
import { TenantContextStorage } from '../services/tenant-context.storage';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

type ResolvedError = {
  status: number;
  message: string | string[];
  error?: string;
};

type ErrorRequestContext = {
  requestId?: string;
  tenantId?: string;
  actorId?: string;
};

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
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

    response.status(resolved.status).json({
      statusCode: resolved.status,
      message: resolved.message,
      error: resolved.error || this.getHttpStatusName(resolved.status),
      ...(eventId ? { eventId } : {}),
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
    let message: string | string[] = exception.message;
    let error: string | undefined;

    if (isRecord(responseBody)) {
      message =
        (responseBody.message as string | string[]) || exception.message;
      error = responseBody.error as string | undefined;
    }

    if (status >= 500 && process.env.NODE_ENV === 'production') {
      const logPayload = {
        type: 'http_error',
        ...(context.requestId ? { requestId: context.requestId } : {}),
        statusCode: status,
        errorName: exception.constructor.name,
        message: exception.message,
        ...(context.tenantId ? { tenantId: context.tenantId } : {}),
        ...(context.actorId ? { actorId: context.actorId } : {}),
      };
      this.logger.error(JSON.stringify(logPayload), exception.stack);
      message = 'Internal server error';
    }

    return { status, message, error };
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
        };
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          message: 'A record with this value already exists.',
        };
      case 'P2003':
        return {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          message:
            'This operation cannot be completed because of a related record.',
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          message: 'The requested record was not found.',
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'An unexpected database error occurred.',
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
    return { status, message: exception.message };
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
        ? 'Internal server error'
        : exception.message;
    return { status: HttpStatus.INTERNAL_SERVER_ERROR, message };
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
      message: 'Internal server error',
    };
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
