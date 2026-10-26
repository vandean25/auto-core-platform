import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import { importUploadFileTooLarge } from './import-upload.errors.js';

/** Maps multer LIMIT_FILE_SIZE to the import wizard upload error shape. */
@Injectable()
export class ImportUploadInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (!(error instanceof HttpException)) {
          return throwError(() => error);
        }
        if (error.getStatus() !== HttpStatus.PAYLOAD_TOO_LARGE) {
          return throwError(() => error);
        }
        const response = error.getResponse();
        if (
          typeof response === 'object' &&
          response !== null &&
          (response as { code?: string }).code ===
            IMPORT_ERROR_CODES.FILE_TOO_LARGE
        ) {
          return throwError(() => error);
        }
        return throwError(() => importUploadFileTooLarge());
      }),
    );
  }
}
