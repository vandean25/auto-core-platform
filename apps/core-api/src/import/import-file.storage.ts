import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Storage } from '@google-cloud/storage';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SideEffectGuard } from '../dry-run/side-effect-guard.js';
import { resolvePdfStorageBucket } from '../common/pdf/pdf-bucket.js';

export type StoredImportFileRef = {
  object_key: string;
};

export interface ImportFileStorage {
  storeUpload(params: {
    tenantId: string;
    jobId: string;
    fileName: string;
    localPath: string;
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
    localPath: string;
  }): Promise<StoredImportFileRef> {
    SideEffectGuard.assertAllowed('GCS_WRITE');
    const bucketName = resolveImportUploadBucket();
    const objectKey = `tenants/${params.tenantId}/imports/${params.jobId}/${params.fileName}`;
    const bucket = this.storage.bucket(bucketName);
    await bucket.upload(params.localPath, {
      destination: objectKey,
      resumable: true,
      metadata: {
        contentType: 'text/csv',
        cacheControl: 'private, no-store',
      },
    });
    return { object_key: objectKey };
  }

  openReadStream(ref: StoredImportFileRef): NodeJS.ReadableStream {
    const bucketName = resolveImportUploadBucket();
    return this.storage.bucket(bucketName).file(ref.object_key).createReadStream();
  }

  async readBytes(ref: StoredImportFileRef): Promise<Buffer> {
    const bucketName = resolveImportUploadBucket();
    const [bytes] = await this.storage
      .bucket(bucketName)
      .file(ref.object_key)
      .download();
    return bytes;
  }

  async deleteUpload(ref: StoredImportFileRef): Promise<void> {
    SideEffectGuard.assertAllowed('GCS_WRITE');
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
    localPath: string;
  }): Promise<StoredImportFileRef> {
    await mkdir(this.root, { recursive: true });
    const objectKey = `${params.tenantId}/${params.jobId}/${params.fileName}`;
    const target = join(this.root, objectKey);
    await mkdir(join(this.root, params.tenantId, params.jobId), {
      recursive: true,
    });
    const bytes = await readFile(params.localPath);
    await writeFile(target, bytes);
    return { object_key: objectKey };
  }

  openReadStream(ref: StoredImportFileRef): NodeJS.ReadableStream {
    return createReadStream(join(this.root, ref.object_key));
  }

  async readBytes(ref: StoredImportFileRef): Promise<Buffer> {
    return readFile(join(this.root, ref.object_key));
  }

  async deleteUpload(ref: StoredImportFileRef): Promise<void> {
    await unlink(join(this.root, ref.object_key)).catch(() => undefined);
  }
}

export const IMPORT_FILE_STORAGE = Symbol('IMPORT_FILE_STORAGE');

export function createImportFileStorage(): ImportFileStorage {
  if (process.env.IMPORT_UPLOAD_STORAGE === 'local') {
    return new LocalImportFileStorage();
  }
  if (process.env.NODE_ENV === 'test') {
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
    localPath: string;
  }): Promise<StoredImportFileRef> {
    return this.delegate.storeUpload(params);
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

export async function persistMulterUploadToTemp(
  file: Express.Multer.File,
): Promise<{ localPath: string; cleanup: () => Promise<void> }> {
  if (file.path) {
    return {
      localPath: file.path,
      cleanup: async () => {
        await unlink(file.path).catch(() => undefined);
      },
    };
  }
  if (!file.buffer) {
    throw new InternalServerErrorException('Import upload is missing file bytes');
  }
  await mkdir(join(tmpdir(), 'acp-import-multer'), { recursive: true });
  const localPath = join(
    tmpdir(),
    'acp-import-multer',
    `${Date.now()}-${file.originalname}`,
  );
  await writeFile(localPath, file.buffer);
  return {
    localPath,
    cleanup: async () => {
      await unlink(localPath).catch(() => undefined);
    },
  };
}
