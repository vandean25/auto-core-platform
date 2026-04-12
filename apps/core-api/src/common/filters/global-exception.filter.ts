import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
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
        message = (responseBody as any).message || exception.message;
      } else {
        message = exception.message;
      }
    }
    // Handle Prisma specific exceptions
    else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2000':
          status = HttpStatus.BAD_REQUEST;
          message = 'Value too long for column';
          break;
        case 'P2002':
          status = HttpStatus.CONFLICT;
          message = 'Unique constraint failed';
          break;
        case 'P2003':
          status = HttpStatus.UNPROCESSABLE_ENTITY;
          message = 'Foreign key constraint failed';
          break;
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          message = 'Record not found';
          break;
        default:
          status = HttpStatus.INTERNAL_SERVER_ERROR;
          message = `Database error: ${exception.code}`;
      }
    }
    // Handle Legacy Domain ApplicationErrors
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
    } else if (exception instanceof Error) {
      // Avoid leaking internal error messages in production?
      // Keeping it simple per instruction, but typically internal 500s shouldn't expose full stack traces.
      message = exception.message;
    }

    response.status(status).json({
      statusCode: status,
      message,
      error: HttpStatus[status],
    });
  }
}
