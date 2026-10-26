import { BadRequestException } from '@nestjs/common';
import { join, resolve, sep } from 'node:path';
import { IMPORT_MULTER_STAGING_DIR } from './import-file.storage.js';

const SAFE_STAGING_FILE = /^[a-f0-9-]{36}\.csv$/;

const stagingKeyByRequest = new WeakMap<object, string>();

/** Records the server-generated multer staging file name for this request. */
export function setImportStagingKey(request: object, fileName: string): void {
  stagingKeyByRequest.set(request, fileName);
}

export function getImportStagingKey(request: object): string | undefined {
  return stagingKeyByRequest.get(request);
}

/** Absolute path under the import multer staging dir; never uses multer `file.path`. */
export function buildImportMulterStagingPath(request: object): string {
  const key = stagingKeyByRequest.get(request);
  if (!key || !SAFE_STAGING_FILE.test(key)) {
    throw new BadRequestException('Invalid import staging file.');
  }
  const root = resolve(IMPORT_MULTER_STAGING_DIR);
  const target = resolve(root, key);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new BadRequestException('Invalid import staging file.');
  }
  return target;
}
