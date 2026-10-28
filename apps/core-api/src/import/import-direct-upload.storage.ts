import { Injectable } from '@nestjs/common';
import { Storage } from '@google-cloud/storage';
import { copyFile, mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { SideEffectGuard } from '../dry-run/side-effect-guard.js';
import {
  IMPORT_LOCAL_UPLOAD_ROOT,
  resolveImportUploadBucket,
} from './import-file.storage.js';
import { buildDirectUploadStagingObjectKey } from './import-direct-upload.js';

export type DirectImportUploadStat = { size: number };

export interface DirectImportUploadStorage {
  signResumableUpload(params: {
    objectKey: string;
    contentType: string;
    maxBytes: number;
    expiresAt: Date;
  }): Promise<{ signedUrl: string }>;

  statStagingObject(objectKey: string): Promise<DirectImportUploadStat | null>;

  copyStagingToJobObject(params: {
    sourceKey: string;
    destinationKey: string;
  }): Promise<void>;

  deleteStagingObject(objectKey: string): Promise<void>;
}

const DIRECT_UPLOAD_COPY_OPTIONS = {
  preconditionOpts: { ifGenerationMatch: 0 },
  contentType: 'text/csv',
  cacheControl: 'private, no-store',
};

function isNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const code = (error as { code?: number | string }).code;
  return code === 404 || code === 'ENOENT';
}

@Injectable()
export class GcsDirectImportUploadStorage implements DirectImportUploadStorage {
  protected storage: Storage = new Storage();

  async signResumableUpload(params: {
    objectKey: string;
    contentType: string;
    maxBytes: number;
    expiresAt: Date;
  }): Promise<{ signedUrl: string }> {
    const [signedUrl] = await this.storage
      .bucket(resolveImportUploadBucket())
      .file(params.objectKey)
      .getSignedUrl({
        version: 'v4',
        action: 'resumable',
        expires: params.expiresAt,
        contentType: params.contentType,
        virtualHostedStyle: false,
      });
    return { signedUrl };
  }

  async statStagingObject(
    objectKey: string,
  ): Promise<DirectImportUploadStat | null> {
    try {
      const [metadata] = await this.storage
        .bucket(resolveImportUploadBucket())
        .file(objectKey)
        .getMetadata();
      return { size: Number(metadata.size) };
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  async copyStagingToJobObject(params: {
    sourceKey: string;
    destinationKey: string;
  }): Promise<void> {
    SideEffectGuard.assertAllowed('GCS_WRITE');
    const bucket = this.storage.bucket(resolveImportUploadBucket());
    await bucket
      .file(params.sourceKey)
      .copy(bucket.file(params.destinationKey), DIRECT_UPLOAD_COPY_OPTIONS);
  }

  async deleteStagingObject(objectKey: string): Promise<void> {
    SideEffectGuard.assertAllowed('GCS_WRITE');
    await this.storage
      .bucket(resolveImportUploadBucket())
      .file(objectKey)
      .delete({ ignoreNotFound: true });
  }
}

export const IMPORT_DIRECT_UPLOAD_LOCAL_ROOT = join(
  tmpdir(),
  'acp-import-direct-uploads',
);

function resolveLocalObjectPath(root: string, objectKey: string): string {
  const segments = objectKey.split('/').filter((segment) => segment.length > 0);
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, ...segments);
  if (target === resolvedRoot || !target.startsWith(`${resolvedRoot}/`)) {
    throw new Error('Invalid direct import upload path');
  }
  return target;
}

function resolveLocalStagingPath(objectKey: string): string {
  return resolveLocalObjectPath(IMPORT_DIRECT_UPLOAD_LOCAL_ROOT, objectKey);
}

/** Promoted files must live where the import worker reads them. */
function resolveLocalJobPath(objectKey: string): string {
  return resolveLocalObjectPath(IMPORT_LOCAL_UPLOAD_ROOT, objectKey);
}

/** Local mode for tests and credential-less runs; production always signs real URLs. */
@Injectable()
export class LocalDirectImportUploadStorage implements DirectImportUploadStorage {
  signResumableUpload(params: {
    objectKey: string;
    contentType: string;
    maxBytes: number;
    expiresAt: Date;
  }): Promise<{ signedUrl: string }> {
    return Promise.resolve({
      signedUrl: `local-direct-upload://${params.objectKey}?max=${params.maxBytes}`,
    });
  }

  async statStagingObject(
    objectKey: string,
  ): Promise<DirectImportUploadStat | null> {
    try {
      const info = await stat(resolveLocalStagingPath(objectKey));
      return { size: info.size };
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  async copyStagingToJobObject(params: {
    sourceKey: string;
    destinationKey: string;
  }): Promise<void> {
    const target = resolveLocalJobPath(params.destinationKey);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(resolveLocalStagingPath(params.sourceKey), target);
  }

  async deleteStagingObject(objectKey: string): Promise<void> {
    await unlink(resolveLocalStagingPath(objectKey)).catch(() => undefined);
  }
}

/** Local-mode hook for e2e suites: write the bytes a browser would have uploaded. */
export async function writeLocalDirectUploadStagingObject(params: {
  tenantId: string;
  uploadId: string;
  fileName: string;
  content: Buffer;
}): Promise<string> {
  const objectKey = buildDirectUploadStagingObjectKey(params);
  const target = resolveLocalStagingPath(objectKey);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, params.content);
  return objectKey;
}

export function createDirectImportUploadStorage(): DirectImportUploadStorage {
  if (process.env.IMPORT_UPLOAD_STORAGE === 'local') {
    return new LocalDirectImportUploadStorage();
  }
  try {
    return new GcsDirectImportUploadStorage();
  } catch (error) {
    if (process.env.NODE_ENV === 'production') {
      throw error;
    }
    return new LocalDirectImportUploadStorage();
  }
}

@Injectable()
export class ImportDirectUploadStorageService implements DirectImportUploadStorage {
  private readonly delegate = createDirectImportUploadStorage();

  signResumableUpload(params: {
    objectKey: string;
    contentType: string;
    maxBytes: number;
    expiresAt: Date;
  }): Promise<{ signedUrl: string }> {
    return this.delegate.signResumableUpload(params);
  }

  statStagingObject(objectKey: string): Promise<DirectImportUploadStat | null> {
    return this.delegate.statStagingObject(objectKey);
  }

  copyStagingToJobObject(params: {
    sourceKey: string;
    destinationKey: string;
  }): Promise<void> {
    return this.delegate.copyStagingToJobObject(params);
  }

  deleteStagingObject(objectKey: string): Promise<void> {
    return this.delegate.deleteStagingObject(objectKey);
  }
}
