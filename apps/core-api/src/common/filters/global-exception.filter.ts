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

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const user = TenantContextStorage.getUser();
    const requestMeta = TenantContextStorage.getRequestMeta();
    const requestId = requestMeta?.requestId;
    const tenantId = user?.tenantId;
    const actorId = user?.userId;

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error: string | undefined;
    let eventId: string | undefined;

    // Handle standard NestJS HttpExceptions
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const responseBody = exception.getResponse();

      if (isRecord(responseBody)) {
        message =
          (responseBody.message as string | string[]) || exception.message;
        error = responseBody.error as string | undefined;
      } else {
        message = exception.message;
      }

      // Mask messages for 500 errors in production
      if (status >= 500 && process.env.NODE_ENV === 'production') {
        const logPayload = {
          type: 'http_error',
          ...(requestId ? { requestId } : {}),
          statusCode: status,
          errorName: exception.constructor.name,
          message: exception.message,
          ...(tenantId ? { tenantId } : {}),
          ...(actorId ? { actorId } : {}),
        };
        this.logger.error(JSON.stringify(logPayload), exception.stack);
        message = 'Internal server error';
      }
    }
    // Handle Prisma specific exceptions (as fallback for unhandled database errors)
    else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Sanitize logging: log only code and meta, skip raw message which might contain values
      const logPayload = {
        type: 'prisma_error',
        ...(requestId ? { requestId } : {}),
        code: exception.code,
        meta: exception.meta ?? {},
        ...(tenantId ? { tenantId } : {}),
        ...(actorId ? { actorId } : {}),
      };
      this.logger.error(JSON.stringify(logPayload));

      switch (exception.code) {
        case 'P2000':
          status = HttpStatus.BAD_REQUEST;
          message = 'The provided value is too long for one of the columns.';
          break;
        case 'P2002':
          status = HttpStatus.CONFLICT;
          message = 'A record with this value already exists.';
          break;
        case 'P2003':
          status = HttpStatus.UNPROCESSABLE_ENTITY;
          message =
            'This operation cannot be completed because of a related record.';
          break;
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          message = 'The requested record was not found.';
          break;
        default:
          status = HttpStatus.INTERNAL_SERVER_ERROR;
          message = 'An unexpected database error occurred.';
      }
    }
    // Handle Domain ApplicationErrors
    else if (exception instanceof ApplicationError) {
      if (exception instanceof ConflictError) {
        status = HttpStatus.CONFLICT;
      } else if (exception instanceof NotFoundError) {
        status = HttpStatus.NOT_FOUND;
      } else if (exception instanceof BadRequestError) {
        status = HttpStatus.BAD_REQUEST;
      } else if (exception instanceof ValidationError) {
        status = HttpStatus.BAD_REQUEST;
      }
      message = exception.message;
    }
    // General Error handling
    else if (exception instanceof Error) {
      const logPayload = {
        type: 'http_error',
        ...(requestId ? { requestId } : {}),
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        errorName: exception.constructor.name,
        message: exception.message,
        ...(tenantId ? { tenantId } : {}),
        ...(actorId ? { actorId } : {}),
      };
      this.logger.error(JSON.stringify(logPayload), exception.stack);

      // Mask messages for 500 errors in production
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      if (process.env.NODE_ENV === 'production') {
        message = 'Internal server error';
      }
    } else {
      const logPayload = {
        type: 'unknown_error',
        ...(requestId ? { requestId } : {}),
        error: String(exception),
        ...(tenantId ? { tenantId } : {}),
        ...(actorId ? { actorId } : {}),
      };
      this.logger.error(JSON.stringify(logPayload));
    }

    if (status >= 500) {
      try {
        const captured = Sentry.captureException(exception);
        if (captured) {
          eventId = captured;
        }
      } catch {
        // Sentry unavailable — omit eventId rather than returning a fake UUID
      }
    }

    response.status(status).json({
      statusCode: status,
      message,
      error: error || this.getHttpStatusName(status),
      ...(eventId ? { eventId } : {}),
    });
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
