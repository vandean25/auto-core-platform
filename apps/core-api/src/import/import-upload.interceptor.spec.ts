import {
  CallHandler,
  ExecutionContext,
  PayloadTooLargeException,
} from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import {
  IMPORT_ERROR_CODES,
  IMPORT_UPLOAD_TOO_LARGE_MESSAGE,
} from './import.constants.js';
import { ImportUploadInterceptor } from './import-upload.interceptor.js';

describe('ImportUploadInterceptor', () => {
  const interceptor = new ImportUploadInterceptor();
  const context = {} as ExecutionContext;

  it('replaces a generic multer payload-too-large error', async () => {
    const next: CallHandler = {
      handle: () =>
        throwError(() => new PayloadTooLargeException('File too large')),
    };

    await expect(
      lastValueFrom(interceptor.intercept(context, next)),
    ).rejects.toMatchObject({
      response: {
        code: IMPORT_ERROR_CODES.FILE_TOO_LARGE,
        message: IMPORT_UPLOAD_TOO_LARGE_MESSAGE,
      },
    });
  });

  it('keeps an import-shaped payload-too-large error', async () => {
    const shaped = new PayloadTooLargeException({
      code: IMPORT_ERROR_CODES.FILE_TOO_LARGE,
      message: IMPORT_UPLOAD_TOO_LARGE_MESSAGE,
    });
    const next: CallHandler = {
      handle: () => throwError(() => shaped),
    };

    await expect(
      lastValueFrom(interceptor.intercept(context, next)),
    ).rejects.toBe(shaped);
  });

  it('passes through successful responses', async () => {
    const next: CallHandler = { handle: () => of({ ok: true }) };
    await expect(
      lastValueFrom(interceptor.intercept(context, next)),
    ).resolves.toEqual({ ok: true });
  });
});
