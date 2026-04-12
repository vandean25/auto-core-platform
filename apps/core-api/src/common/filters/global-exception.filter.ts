import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import {
  ApplicationError,
  ConflictError,
  NotFoundError,
  BadRequestError,
  ValidationError,
} from '../errors/application-errors';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';

    // Handle standard NestJS HttpExceptions
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const responseBody = exception.getResponse();
      if (typeof responseBody === 'object' && responseBody !== null) {
        message = (responseBody as Record<string, unknown>).message as
          | string
          | string[] || exception.message;
      } else {
        message = exception.message;
      }

      // Mask messages for 500 errors in production-like environments
      if (status >= 500) {
        this.logger.error(`HttpException ${status}: ${exception.message}`, exception.stack);
        message = 'Internal server error';
      }
    }
    // Handle Prisma specific exceptions (as fallback for unhandled database errors)
    else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Sanitize logging: log only code and meta, skip raw message which might contain values
      this.logger.error(`Prisma error ${exception.code}`, { meta: exception.meta });
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
          message = 'This operation cannot be completed because of a related record.';
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
      this.logger.error(`Unhandled error: ${exception.message}`, exception.stack);
      // Mask messages for 500 errors in production-like environments
      // For simplicity here, we always mask for 500s unless they are HttpExceptions or ApplicationErrors
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';
    } else {
      this.logger.error('Unknown error caught by filter', exception);
    }

    response.status(status).json({
      statusCode: status,
      message,
      error: HttpStatus[status],
    });
  }
}
