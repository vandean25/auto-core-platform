import { BadRequestException } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { parseCsvFile, type ParsedCsv } from './csv-parse.util.js';
import { parseCsvBufferHeadersOnly } from './import-csv-batch.util.js';
import { assessImportCsvFromReadable } from './import-csv-stream.util.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import { buildImportMulterStagingPath } from './import-staging-path.js';
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

function assertRowLimits(dataRowCount: number): void {
  const maxRowCount = readImportMaxRowCount();
  if (dataRowCount > maxRowCount) {
    throw new BadRequestException({
      code: IMPORT_ERROR_CODES.ROW_LIMIT_EXCEEDED,
      message: `CSV exceeds ${maxRowCount} rows`,
    });
  }
}

function assertNonEmpty(headers: string[], dataRowCount: number): void {
  if (headers.length === 0 || dataRowCount === 0) {
    throw new BadRequestException({
      code: IMPORT_ERROR_CODES.EMPTY_FILE,
      message: 'CSV file has no data rows',
    });
  }
}

function openStagingReadStream(request: object): NodeJS.ReadableStream {
  const stagingPath = buildImportMulterStagingPath(request);
  return createReadStream(stagingPath);
}

/** Checks an uploaded CSV and parses it when the file is small enough for sync handling. */
export async function assessImportUpload(
  file: Express.Multer.File,
  request?: object,
): Promise<ImportUploadStats> {
  if (!file?.buffer && !request) {
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

  const useBackgroundBySize = isBackgroundImportCandidate({
    fileBytes: file.size,
  });

  if (request) {
    if (useBackgroundBySize) {
      const headerStats = await assessImportCsvFromReadable(
        openStagingReadStream(request),
      );
      assertNonEmpty(headerStats.headers, headerStats.dataRowCount);
      assertRowLimits(headerStats.dataRowCount);
      return {
        rowCount: headerStats.dataRowCount,
        sha256: headerStats.sha256,
        useBackground: true,
      };
    }
    const stagingPath = buildImportMulterStagingPath(request);
    const buffer = await readFile(stagingPath);
    const headerStats = parseCsvBufferHeadersOnly(buffer);
    assertNonEmpty(headerStats.headers, headerStats.dataRowCount);
    assertRowLimits(headerStats.dataRowCount);
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
    await unlink(stagingPath).catch(() => undefined);
    const parsed = parseCsvFile(buffer);
    return {
      parsed,
      rowCount: parsed.rows.length,
      sha256: parsed.sha256,
      useBackground: false,
    };
  }

  const buffer = file.buffer;
  const headerStats = parseCsvBufferHeadersOnly(buffer);
  assertNonEmpty(headerStats.headers, headerStats.dataRowCount);
  assertRowLimits(headerStats.dataRowCount);

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

export async function unlinkImportMulterStagingFile(
  request: object,
): Promise<void> {
  const stagingPath = buildImportMulterStagingPath(request);
  await unlink(stagingPath).catch(() => undefined);
}

export function openImportMulterStagingReadStream(
  request: object,
): NodeJS.ReadableStream {
  return openStagingReadStream(request);
}
