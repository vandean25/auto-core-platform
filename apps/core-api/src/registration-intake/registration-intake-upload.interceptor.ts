import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { HttpException, HttpStatus } from '@nestjs/common';
import {
  registrationFileTooLarge,
  registrationTooManyFiles,
} from './registration-intake.errors.js';

@Injectable()
export class RegistrationIntakeUploadInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (!(error instanceof HttpException)) {
          return throwError(() => error);
        }
        const status: HttpStatus = error.getStatus();
        const response = error.getResponse();
        const message =
          typeof response === 'string'
            ? response
            : typeof response === 'object' &&
                response !== null &&
                typeof (response as { message?: unknown }).message === 'string'
              ? (response as { message: string }).message
              : error.message;

        if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
          return throwError(() => registrationFileTooLarge());
        }
        if (status === HttpStatus.BAD_REQUEST) {
          const base = message.split(' - ')[0]?.trim();
          if (base === 'Too many files' || base === 'Unexpected file field') {
            return throwError(() => registrationTooManyFiles());
          }
        }
        return throwError(() => error);
      }),
    );
  }
}
