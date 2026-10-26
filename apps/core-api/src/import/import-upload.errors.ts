import { PayloadTooLargeException } from '@nestjs/common';
import {
  IMPORT_ERROR_CODES,
  IMPORT_UPLOAD_TOO_LARGE_MESSAGE,
} from './import.constants.js';

export function importUploadFileTooLarge(): PayloadTooLargeException {
  return new PayloadTooLargeException({
    code: IMPORT_ERROR_CODES.FILE_TOO_LARGE,
    message: IMPORT_UPLOAD_TOO_LARGE_MESSAGE,
  });
}
