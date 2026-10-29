import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { Storage } from '@google-cloud/storage';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import type { Readable, Transform, Writable } from 'node:stream';
import { Readable as ReadableStream } from 'node:stream';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { SideEffectGuard } from '../dry-run/side-effect-guard.js';
import { resolvePdfStorageBucket } from '../common/pdf/pdf-bucket.js';
import { withTransientGcsAttempts } from './import-gcs-retry.js';
import {
  fetchGcsObjectMedia,
  isRangeNotSatisfiable,
} from './import-gcs-media.js';

export type StoredImportFileRef = {
  object_key: string;
};

const DEFAULT_IMPORT_FILE_NAME = 'import.csv';
const SAFE_PATH_SEGMENT = /^[a-zA-Z0-9._-]+$/;
export const IMPORT_MULTER_STAGING_DIR = join(tmpdir(), 'acp-import-multer');
export const IMPORT_LOCAL_UPLOAD_ROOT = join(tmpdir(), 'acp-import-uploads');

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
      (root) => resolved === root || resolved.startsWith(`${root}${sep}`),
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

export function assertSafePathSegment(segment: string, label: string): void {
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
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${sep}`)) {
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
    openSource: () => NodeJS.ReadableStream;
    openThrough?: () => Transform;
    contentLength?: number;
    expectedMd5?: () => string | undefined;
  }): Promise<StoredImportFileRef>;

  openReadStream(
    ref: StoredImportFileRef,
    start?: number,
  ): NodeJS.ReadableStream;

  readByteRange(
    ref: StoredImportFileRef,
    start: number,
    end: number,
  ): Promise<Buffer>;

  readBytes(ref: StoredImportFileRef): Promise<Buffer>;

  deleteUpload(ref: StoredImportFileRef): Promise<void>;
}

export function resolveImportUploadBucket(): string {
  const dedicated = process.env.IMPORT_UPLOAD_BUCKET?.trim();
  if (dedicated) {
    return dedicated;
  }
  return resolvePdfStorageBucket();
}

const IMPORT_UPLOAD_SAVE_OPTIONS = {
  resumable: false as const,
  preconditionOpts: { ifGenerationMatch: 0 },
  metadata: {
    contentType: 'text/csv',
    cacheControl: 'private, no-store',
  },
};

type ImportObjectFile = {
  save: (
    data: Buffer,
    options: typeof IMPORT_UPLOAD_SAVE_OPTIONS,
  ) => Promise<unknown>;
  delete: (options: { ignoreNotFound: boolean }) => Promise<unknown>;
  createWriteStream: (options: typeof IMPORT_UPLOAD_SAVE_OPTIONS) => Writable;
  getMetadata: () => Promise<[{ size?: string | number; md5Hash?: string }]>;
  download: () => Promise<[Buffer]>;
};

export const IMPORT_READ_RANGE_BYTES = 2 * 1024 * 1024;

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function objectMatchesBuffer(
  file: ImportObjectFile,
  content: Buffer,
): Promise<boolean> {
  const [metadata] = await file.getMetadata();
  if (Number(metadata.size) !== content.length) {
    return false;
  }
  const md5 = createHash('md5').update(content).digest('base64');
  if (typeof metadata.md5Hash === 'string') {
    return metadata.md5Hash === md5;
  }
  const [stored] = await file.download();
  return sha256(stored) === sha256(content);
}

async function objectMatchesStream(
  file: ImportObjectFile,
  contentLength: number,
  expectedMd5?: string,
): Promise<boolean> {
  const [metadata] = await file.getMetadata();
  if (Number(metadata.size) !== contentLength) {
    return false;
  }
  if (!expectedMd5) {
    return true;
  }
  if (typeof metadata.md5Hash === 'string') {
    return metadata.md5Hash === expectedMd5;
  }
  const [stored] = await file.download();
  return createHash('md5').update(stored).digest('base64') === expectedMd5;
}

function releaseWritable(stream: Writable): void {
  const swallow = () => undefined;
  stream.on('error', swallow);
  stream.destroy();
  setImmediate(() => {
    stream.removeAllListeners();
  });
}

async function writeImportObject(
  file: ImportObjectFile,
  source: NodeJS.ReadableStream,
  through?: Transform,
): Promise<void> {
  const writeStream = file.createWriteStream(IMPORT_UPLOAD_SAVE_OPTIONS);
  const onError = () => undefined;
  writeStream.once('error', onError);
  try {
    if (through) {
      await pipeline(source as Readable, through, writeStream);
      return;
    }
    await pipeline(source as Readable, writeStream);
  } finally {
    writeStream.off('error', onError);
    releaseWritable(writeStream);
  }
}

@Injectable()
export class GcsImportFileStorage implements ImportFileStorage {
  protected storage: Storage = new Storage();

  async storeUpload(params: {
    tenantId: string;
    jobId: string;
    fileName: string;
    content: Buffer;
  }): Promise<StoredImportFileRef> {
    return this.putNewObject(
      params,
      (file) => file.save(params.content, IMPORT_UPLOAD_SAVE_OPTIONS),
      (file) => objectMatchesBuffer(file, params.content),
    );
  }

  async storeUploadFromStream(params: {
    tenantId: string;
    jobId: string;
    fileName: string;
    openSource: () => NodeJS.ReadableStream;
    openThrough?: () => Transform;
    contentLength?: number;
    expectedMd5?: () => string | undefined;
  }): Promise<StoredImportFileRef> {
    return this.putNewObject(
      params,
      (file) =>
        writeImportObject(file, params.openSource(), params.openThrough?.()),
      (file) =>
        params.contentLength === undefined
          ? Promise.resolve(false)
          : objectMatchesStream(
              file,
              params.contentLength,
              params.expectedMd5?.(),
            ),
    );
  }

  private importFile(objectKey: string): ImportObjectFile {
    const bucket = resolveImportUploadBucket();
    const gcsFile = this.storage.bucket(bucket).file(objectKey);
    return {
      save: (data, options) => gcsFile.save(data, options),
      delete: (options) => gcsFile.delete(options),
      createWriteStream: (options) => gcsFile.createWriteStream(options),
      getMetadata: async () => {
        const [metadata] = await gcsFile.getMetadata();
        return [metadata];
      },
      download: async () => [
        await fetchGcsObjectMedia(this.storage, bucket, objectKey),
      ],
    };
  }

  private putNewObject(
    params: { tenantId: string; jobId: string; fileName: string },
    write: (file: ImportObjectFile) => Promise<unknown>,
    committed: (file: ImportObjectFile) => Promise<boolean>,
  ): Promise<StoredImportFileRef> {
    SideEffectGuard.assertAllowed('GCS_WRITE');
    const objectKey = buildGcsImportObjectKey(params);
    const file = this.importFile(objectKey);
    return withTransientGcsAttempts(
      params.jobId,
      () => write(file).then(() => undefined),
      () => file.delete({ ignoreNotFound: true }).then(() => undefined),
      () => committed(file),
    ).then(() => ({ object_key: objectKey }));
  }

  openReadStream(ref: StoredImportFileRef, start = 0): NodeJS.ReadableStream {
    let cursor = start;
    const pull = (): Promise<Buffer | null> =>
      this.readByteRange(ref, cursor, cursor + IMPORT_READ_RANGE_BYTES - 1)
        .then((bytes) => {
          if (bytes.length < IMPORT_READ_RANGE_BYTES) {
            cursor += bytes.length;
            return bytes.length > 0 ? bytes : null;
          }
          cursor += bytes.length;
          return bytes;
        })
        .catch((error: unknown) => {
          if (isRangeNotSatisfiable(error)) {
            return null;
          }
          throw error;
        });
    return new ReadableStream({
      read() {
        pull().then(
          (bytes) => {
            this.push(bytes);
          },
          (error: unknown) => {
            this.destroy(
              error instanceof Error ? error : new Error('read failed'),
            );
          },
        );
      },
    });
  }

  async readByteRange(
    ref: StoredImportFileRef,
    start: number,
    end: number,
  ): Promise<Buffer> {
    assertSafeGcsImportObjectKey(ref.object_key);
    return fetchGcsObjectMedia(
      this.storage,
      resolveImportUploadBucket(),
      ref.object_key,
      start,
      end,
    );
  }

  async readBytes(ref: StoredImportFileRef): Promise<Buffer> {
    assertSafeGcsImportObjectKey(ref.object_key);
    return fetchGcsObjectMedia(
      this.storage,
      resolveImportUploadBucket(),
      ref.object_key,
    );
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
  private readonly root = IMPORT_LOCAL_UPLOAD_ROOT;

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
    openSource: () => NodeJS.ReadableStream;
    openThrough?: () => Transform;
    contentLength?: number;
    expectedMd5?: () => string | undefined;
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
    const through = params.openThrough?.();
    if (through) {
      await pipeline(
        params.openSource() as Readable,
        through,
        writeStream as Writable,
      );
    } else {
      await pipeline(params.openSource() as Readable, writeStream as Writable);
    }
    return { object_key: objectKey };
  }

  openReadStream(ref: StoredImportFileRef, start = 0): NodeJS.ReadableStream {
    return createReadStream(resolveLocalImportPath(this.root, ref.object_key), {
      start,
    });
  }

  async readByteRange(
    ref: StoredImportFileRef,
    start: number,
    end: number,
  ): Promise<Buffer> {
    const handle = await open(
      resolveLocalImportPath(this.root, ref.object_key),
      'r',
    );
    try {
      const length = end - start + 1;
      const buf = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buf, 0, length, start);
      return buf.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
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
    openSource: () => NodeJS.ReadableStream;
    openThrough?: () => Transform;
    contentLength?: number;
    expectedMd5?: () => string | undefined;
  }): Promise<StoredImportFileRef> {
    return this.delegate.storeUploadFromStream(params);
  }

  openReadStream(ref: StoredImportFileRef, start = 0): NodeJS.ReadableStream {
    return this.delegate.openReadStream(ref, start);
  }

  readByteRange(
    ref: StoredImportFileRef,
    start: number,
    end: number,
  ): Promise<Buffer> {
    return this.delegate.readByteRange(ref, start, end);
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
