import { BadRequestException } from '@nestjs/common';
import { parseCsvFile, type ParsedCsv } from './csv-parse.util.js';
import { parseCsvBufferHeadersOnly } from './import-csv-batch.util.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import {
  isBackgroundImportCandidate,
  readImportMaxFileBytes,
  readImportMaxRowCount,
} from './import-limits.js';

export type ImportUploadStats = {
  parsed?: ParsedCsv;
  rowCount: number;
  sha256: string;
  useBackground: boolean;
};

/** Checks an uploaded CSV and parses it when the file is small enough for sync handling. */
export function assessImportUpload(
  file: Express.Multer.File,
): ImportUploadStats {
  if (!file?.buffer && !file?.path) {
    throw new BadRequestException({
      code: IMPORT_ERROR_CODES.EMPTY_FILE,
      message: 'CSV file is required',
    });
  }
  const maxFileBytes = readImportMaxFileBytes();
  if (file.size > maxFileBytes) {
    throw new BadRequestException({
      code: IMPORT_ERROR_CODES.FILE_TOO_LARGE,
      message: `CSV file exceeds ${maxFileBytes} bytes`,
    });
  }

  const buffer = file.buffer ?? undefined;
  if (!buffer) {
    const useBackground = isBackgroundImportCandidate({ fileBytes: file.size });
    return {
      rowCount: 0,
      sha256: '',
      useBackground,
    };
  }

  const headerStats = parseCsvBufferHeadersOnly(buffer);
  if (headerStats.headers.length === 0 || headerStats.dataRowCount === 0) {
    throw new BadRequestException({
      code: IMPORT_ERROR_CODES.EMPTY_FILE,
      message: 'CSV file has no data rows',
    });
  }
  const maxRowCount = readImportMaxRowCount();
  if (headerStats.dataRowCount > maxRowCount) {
    throw new BadRequestException({
      code: IMPORT_ERROR_CODES.ROW_LIMIT_EXCEEDED,
      message: `CSV exceeds ${maxRowCount} rows`,
    });
  }

  const useBackground = isBackgroundImportCandidate({
    fileBytes: file.size,
    rowCount: headerStats.dataRowCount,
  });
  if (useBackground) {
    return {
      rowCount: headerStats.dataRowCount,
      sha256: headerStats.sha256,
      useBackground: true,
    };
  }

  const parsed = parseCsvFile(buffer);
  return {
    parsed,
    rowCount: parsed.rows.length,
    sha256: parsed.sha256,
    useBackground: false,
  };
}

/** Legacy entry point for synchronous imports. */
export function parseImportUpload(file: Express.Multer.File): ParsedCsv {
  const assessed = assessImportUpload(file);
  if (assessed.useBackground || !assessed.parsed) {
    throw new BadRequestException({
      code: IMPORT_ERROR_CODES.ROW_LIMIT_EXCEEDED,
      message: 'CSV requires background import processing',
    });
  }
  return assessed.parsed;
}
