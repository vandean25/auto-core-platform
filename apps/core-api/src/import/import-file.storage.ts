import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { Storage } from '@google-cloud/storage';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import type { Readable, Transform, Writable } from 'node:stream';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { SideEffectGuard } from '../dry-run/side-effect-guard.js';
import { resolvePdfStorageBucket } from '../common/pdf/pdf-bucket.js';

export type StoredImportFileRef = {
  object_key: string;
};

const DEFAULT_IMPORT_FILE_NAME = 'import.csv';
const SAFE_PATH_SEGMENT = /^[a-zA-Z0-9._-]+$/;
export const IMPORT_MULTER_STAGING_DIR = join(tmpdir(), 'acp-import-multer');
const IMPORT_LOCAL_UPLOAD_ROOT = join(tmpdir(), 'acp-import-uploads');

/** Ensures multer staging paths stay under the OS temp directory. */
export function assertTrustedImportStagingPath(localPath: string): string {
  const resolved = resolve(localPath);
  const allowedRoots = [
    resolve(tmpdir()),
    resolve(IMPORT_MULTER_STAGING_DIR),
    resolve(IMPORT_LOCAL_UPLOAD_ROOT),
  ];
  if (
    allowedRoots.some(
      (root) => resolved === root || resolved.startsWith(`${root}/`),
    )
  ) {
    return resolved;
  }
  throw new BadRequestException('Invalid import staging path.');
}

/** Basename-only file label safe for object keys and temp paths. */
export function sanitizeImportFileName(fileName: string): string {
  const normalized = fileName.normalize('NFC').replace(/\0/g, '');
  const lastSegment =
    normalized
      .split(/[/\\]/)
      .filter((part) => part.length > 0)
      .pop() ?? normalized;
  const cleaned = basename(lastSegment)
    .replace(/[\\/\p{Cc}\p{Cf}"]/gu, ' ')
    .trim()
    .slice(0, 255);
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    return DEFAULT_IMPORT_FILE_NAME;
  }
  return cleaned;
}

function assertSafePathSegment(segment: string, label: string): void {
  if (!segment || segment === '.' || segment === '..') {
    throw new BadRequestException(`Invalid import ${label}.`);
  }
  if (!SAFE_PATH_SEGMENT.test(segment)) {
    throw new BadRequestException(`Invalid import ${label}.`);
  }
}

export function buildTenantImportObjectKey(params: {
  tenantId: string;
  jobId: string;
  fileName: string;
}): string {
  assertSafePathSegment(params.tenantId, 'tenant id');
  assertSafePathSegment(params.jobId, 'job id');
  const safeName = sanitizeImportFileName(params.fileName);
  return `${params.tenantId}/${params.jobId}/${safeName}`;
}

export function buildGcsImportObjectKey(params: {
  tenantId: string;
  jobId: string;
  fileName: string;
}): string {
  assertSafePathSegment(params.tenantId, 'tenant id');
  assertSafePathSegment(params.jobId, 'job id');
  const safeName = sanitizeImportFileName(params.fileName);
  return `tenants/${params.tenantId}/imports/${params.jobId}/${safeName}`;
}

function assertSafeStoredObjectKey(objectKey: string): void {
  const segments = objectKey.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    throw new BadRequestException('Invalid import object key.');
  }
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new BadRequestException('Invalid import object key.');
    }
  }
}

function resolveLocalImportPath(root: string, objectKey: string): string {
  assertSafeStoredObjectKey(objectKey);
  const segments = objectKey.split('/').filter((segment) => segment.length > 0);
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, ...segments);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}/`)) {
    throw new BadRequestException('Invalid import object key.');
  }
  return target;
}

function assertSafeGcsImportObjectKey(objectKey: string): void {
  if (!objectKey.startsWith('tenants/')) {
    throw new BadRequestException('Invalid import object key.');
  }
  assertSafeStoredObjectKey(objectKey);
  const tail = objectKey.slice('tenants/'.length);
  const segments = tail.split('/').filter((segment) => segment.length > 0);
  if (segments.length !== 4 || segments[1] !== 'imports') {
    throw new BadRequestException('Invalid import object key.');
  }
  assertSafePathSegment(segments[0], 'tenant id');
  assertSafePathSegment(segments[2], 'job id');
}

export interface ImportFileStorage {
  storeUpload(params: {
    tenantId: string;
    jobId: string;
    fileName: string;
    content: Buffer;
  }): Promise<StoredImportFileRef>;

  storeUploadFromStream(params: {
    tenantId: string;
    jobId: string;
    fileName: string;
    source: NodeJS.ReadableStream;
    through?: Transform;
  }): Promise<StoredImportFileRef>;

  openReadStream(ref: StoredImportFileRef): NodeJS.ReadableStream;

  readBytes(ref: StoredImportFileRef): Promise<Buffer>;

  deleteUpload(ref: StoredImportFileRef): Promise<void>;
}

function resolveImportUploadBucket(): string {
  const dedicated = process.env.IMPORT_UPLOAD_BUCKET?.trim();
  if (dedicated) {
    return dedicated;
  }
  return resolvePdfStorageBucket();
}

@Injectable()
export class GcsImportFileStorage implements ImportFileStorage {
  private readonly storage = new Storage();

  async storeUpload(params: {
    tenantId: string;
    jobId: string;
    fileName: string;
    content: Buffer;
  }): Promise<StoredImportFileRef> {
    SideEffectGuard.assertAllowed('GCS_WRITE');
    const bucketName = resolveImportUploadBucket();
    const objectKey = buildGcsImportObjectKey({
      tenantId: params.tenantId,
      jobId: params.jobId,
      fileName: params.fileName,
    });
    const bucket = this.storage.bucket(bucketName);
    await bucket.file(objectKey).save(params.content, {
      resumable: false,
      metadata: {
        contentType: 'text/csv',
        cacheControl: 'private, no-store',
      },
    });
    return { object_key: objectKey };
  }

  async storeUploadFromStream(params: {
    tenantId: string;
    jobId: string;
    fileName: string;
    source: NodeJS.ReadableStream;
    through?: Transform;
  }): Promise<StoredImportFileRef> {
    SideEffectGuard.assertAllowed('GCS_WRITE');
    const bucketName = resolveImportUploadBucket();
    const objectKey = buildGcsImportObjectKey({
      tenantId: params.tenantId,
      jobId: params.jobId,
      fileName: params.fileName,
    });
    const writeStream = this.storage
      .bucket(bucketName)
      .file(objectKey)
      .createWriteStream({
        resumable: false,
        metadata: {
          contentType: 'text/csv',
          cacheControl: 'private, no-store',
        },
      });
    if (params.through) {
      await pipeline(params.source as Readable, params.through, writeStream);
    } else {
      await pipeline(params.source as Readable, writeStream);
    }
    return { object_key: objectKey };
  }

  openReadStream(ref: StoredImportFileRef): NodeJS.ReadableStream {
    assertSafeGcsImportObjectKey(ref.object_key);
    const bucketName = resolveImportUploadBucket();
    return this.storage
      .bucket(bucketName)
      .file(ref.object_key)
      .createReadStream();
  }

  async readBytes(ref: StoredImportFileRef): Promise<Buffer> {
    assertSafeGcsImportObjectKey(ref.object_key);
    const bucketName = resolveImportUploadBucket();
    const [bytes] = await this.storage
      .bucket(bucketName)
      .file(ref.object_key)
      .download();
    return bytes;
  }

  async deleteUpload(ref: StoredImportFileRef): Promise<void> {
    SideEffectGuard.assertAllowed('GCS_WRITE');
    assertSafeGcsImportObjectKey(ref.object_key);
    const bucketName = resolveImportUploadBucket();
    await this.storage
      .bucket(bucketName)
      .file(ref.object_key)
      .delete({ ignoreNotFound: true });
  }
}

/** In-memory / temp-dir storage for tests and local runs without GCS credentials. */
@Injectable()
export class LocalImportFileStorage implements ImportFileStorage {
  private readonly root = join(tmpdir(), 'acp-import-uploads');

  async storeUpload(params: {
    tenantId: string;
    jobId: string;
    fileName: string;
    content: Buffer;
  }): Promise<StoredImportFileRef> {
    await mkdir(this.root, { recursive: true });
    const objectKey = buildTenantImportObjectKey({
      tenantId: params.tenantId,
      jobId: params.jobId,
      fileName: params.fileName,
    });
    const target = resolveLocalImportPath(this.root, objectKey);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, params.content);
    return { object_key: objectKey };
  }

  async storeUploadFromStream(params: {
    tenantId: string;
    jobId: string;
    fileName: string;
    source: NodeJS.ReadableStream;
    through?: Transform;
  }): Promise<StoredImportFileRef> {
    await mkdir(this.root, { recursive: true });
    const objectKey = buildTenantImportObjectKey({
      tenantId: params.tenantId,
      jobId: params.jobId,
      fileName: params.fileName,
    });
    const target = resolveLocalImportPath(this.root, objectKey);
    await mkdir(dirname(target), { recursive: true });
    const writeStream = createWriteStream(target);
    if (params.through) {
      await pipeline(
        params.source as Readable,
        params.through,
        writeStream as Writable,
      );
    } else {
      await pipeline(params.source as Readable, writeStream as Writable);
    }
    return { object_key: objectKey };
  }

  openReadStream(ref: StoredImportFileRef): NodeJS.ReadableStream {
    return createReadStream(resolveLocalImportPath(this.root, ref.object_key));
  }

  async readBytes(ref: StoredImportFileRef): Promise<Buffer> {
    return readFile(resolveLocalImportPath(this.root, ref.object_key));
  }

  async deleteUpload(ref: StoredImportFileRef): Promise<void> {
    await unlink(resolveLocalImportPath(this.root, ref.object_key)).catch(
      () => undefined,
    );
  }
}

export function createImportFileStorage(): ImportFileStorage {
  if (process.env.IMPORT_UPLOAD_STORAGE === 'local') {
    return new LocalImportFileStorage();
  }
  try {
    return new GcsImportFileStorage();
  } catch (error) {
    if (process.env.NODE_ENV === 'production') {
      throw error;
    }
    return new LocalImportFileStorage();
  }
}

@Injectable()
export class ImportFileStorageService implements ImportFileStorage {
  private readonly delegate = createImportFileStorage();

  storeUpload(params: {
    tenantId: string;
    jobId: string;
    fileName: string;
    content: Buffer;
  }): Promise<StoredImportFileRef> {
    return this.delegate.storeUpload(params);
  }

  storeUploadFromStream(params: {
    tenantId: string;
    jobId: string;
    fileName: string;
    source: NodeJS.ReadableStream;
    through?: Transform;
  }): Promise<StoredImportFileRef> {
    return this.delegate.storeUploadFromStream(params);
  }

  openReadStream(ref: StoredImportFileRef): NodeJS.ReadableStream {
    return this.delegate.openReadStream(ref);
  }

  readBytes(ref: StoredImportFileRef): Promise<Buffer> {
    return this.delegate.readBytes(ref);
  }

  deleteUpload(ref: StoredImportFileRef): Promise<void> {
    return this.delegate.deleteUpload(ref);
  }
}

/** Nest multer uses in-memory storage for import uploads; bytes must be present. */
export function readMulterUploadContent(file: Express.Multer.File): Buffer {
  if (!file.buffer?.length) {
    throw new InternalServerErrorException(
      'Import upload is missing file bytes',
    );
  }
  return file.buffer;
}
