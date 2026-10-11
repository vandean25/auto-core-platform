import { BadRequestException } from '@nestjs/common';
import { parseCsvFile, type ParsedCsv } from './csv-parse.util.js';
import {
  IMPORT_ERROR_CODES,
  IMPORT_MAX_FILE_BYTES,
  IMPORT_MAX_ROW_COUNT,
} from './import.constants.js';

/** Checks an uploaded CSV and parses it. Rejects empty, oversized and over-long files. */
export function parseImportUpload(file: Express.Multer.File): ParsedCsv {
  if (!file?.buffer) {
    throw new BadRequestException({
      code: IMPORT_ERROR_CODES.EMPTY_FILE,
      message: 'CSV file is required',
    });
  }
  if (file.size > IMPORT_MAX_FILE_BYTES) {
    throw new BadRequestException({
      code: IMPORT_ERROR_CODES.FILE_TOO_LARGE,
      message: `CSV file exceeds ${IMPORT_MAX_FILE_BYTES} bytes`,
    });
  }

  const parsed = parseCsvFile(file.buffer);
  if (parsed.headers.length === 0 || parsed.rows.length === 0) {
    throw new BadRequestException({
      code: IMPORT_ERROR_CODES.EMPTY_FILE,
      message: 'CSV file has no data rows',
    });
  }
  if (parsed.rows.length > IMPORT_MAX_ROW_COUNT) {
    throw new BadRequestException({
      code: IMPORT_ERROR_CODES.ROW_LIMIT_EXCEEDED,
      message: `CSV exceeds ${IMPORT_MAX_ROW_COUNT} rows`,
    });
  }
  return parsed;
}
