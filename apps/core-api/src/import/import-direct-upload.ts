import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import {
  assertSafePathSegment,
  sanitizeImportFileName,
} from './import-file.storage.js';

/** Resumable session must be started soon after the wizard asks for it. */
export const IMPORT_DIRECT_UPLOAD_URL_TTL_MS = 15 * 60 * 1000;

const IMPORT_DIRECT_UPLOAD_PATH_PREFIX = 'import-uploads/tenants';
const DIRECT_UPLOAD_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_CONTENT_TYPES = new Set([
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
]);

export function importDirectUploadInvalid(): BadRequestException {
  return new BadRequestException({
    code: IMPORT_ERROR_CODES.DIRECT_UPLOAD_INVALID,
    message: 'Invalid direct import upload.',
  });
}

export function importDirectUploadNotFound(): NotFoundException {
  return new NotFoundException({
    code: IMPORT_ERROR_CODES.DIRECT_UPLOAD_NOT_FOUND,
    message: 'Direct import upload not found or already finalized.',
  });
}

export function importDirectUploadTooLarge(): PayloadTooLargeException {
  return new PayloadTooLargeException({
    code: IMPORT_ERROR_CODES.DIRECT_UPLOAD_TOO_LARGE,
    message: 'Direct import upload is too large.',
  });
}

export function importDirectUploadUnsupportedContentType(): BadRequestException {
  return new BadRequestException({
    code: IMPORT_ERROR_CODES.DIRECT_UPLOAD_CONTENT_TYPE,
    message: 'This file type is not supported for direct import upload.',
  });
}

/** Returns the sanitized file label used in the staging and job object keys. */
export function assertDirectUploadFileName(raw: string): string {
  const safeName = sanitizeImportFileName(raw ?? '').trim();
  if (!safeName.toLowerCase().endsWith('.csv') || safeName.length > 255) {
    throw importDirectUploadInvalid();
  }
  return safeName;
}

export function assertDirectUploadId(uploadId: string): string {
  if (!DIRECT_UPLOAD_ID_PATTERN.test(uploadId ?? '')) {
    throw importDirectUploadInvalid();
  }
  return uploadId;
}

export function assertDirectUploadSize(
  declaredBytes: number,
  maxBytes: number,
): number {
  if (!Number.isInteger(declaredBytes) || declaredBytes <= 0) {
    throw importDirectUploadInvalid();
  }
  if (declaredBytes > maxBytes) {
    throw importDirectUploadTooLarge();
  }
  return declaredBytes;
}

export function normalizeDirectUploadContentType(
  raw: string | undefined,
): string {
  if (!raw?.trim()) {
    return 'text/csv';
  }
  const normalized = raw.trim().toLowerCase().split(';')[0].trim();
  if (!ALLOWED_CONTENT_TYPES.has(normalized)) {
    throw importDirectUploadUnsupportedContentType();
  }
  return normalized;
}

export function buildDirectUploadStagingObjectKey(params: {
  tenantId: string;
  uploadId: string;
  fileName: string;
}): string {
  assertSafePathSegment(params.tenantId, 'tenant id');
  assertDirectUploadId(params.uploadId);
  const safeName = assertDirectUploadFileName(params.fileName);
  return `${IMPORT_DIRECT_UPLOAD_PATH_PREFIX}/${params.tenantId}/${params.uploadId}/${safeName}`;
}

/** The only staging keys finalize may touch belong to the caller's tenant. */
export function assertDirectUploadStagingKeyForTenant(
  objectKey: string,
  tenantId: string,
): void {
  const tenantPrefix = `${IMPORT_DIRECT_UPLOAD_PATH_PREFIX}/${tenantId}/`;
  if (!objectKey.startsWith(tenantPrefix)) {
    throw importDirectUploadNotFound();
  }
  const rest = objectKey.slice(tenantPrefix.length).split('/');
  if (rest.length !== 2) {
    throw importDirectUploadNotFound();
  }
  assertDirectUploadId(rest[0]);
  if (!rest[1] || rest[1] === '.' || rest[1] === '..') {
    throw importDirectUploadNotFound();
  }
}
