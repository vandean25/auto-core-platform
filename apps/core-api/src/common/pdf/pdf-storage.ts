import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Storage } from '@google-cloud/storage';
import { Readable } from 'node:stream';
import * as Sentry from '@sentry/node';
import { resolvePdfStorageBucket } from './pdf-bucket.js';
import { SideEffectGuard } from '../../dry-run/side-effect-guard.js';

export type PdfArchiveIdentityMetadata = {
  tenant_id: string;
  invoice_id: string;
  snapshot_sha256: string;
  template_version: string;
};

export type ImmutablePdfArchive = {
  bucket: string;
  key: string;
  generation: string;
  sha256: string;
  customMetadata: PdfArchiveIdentityMetadata & { pdf_sha256: string };
};

/** Custom metadata for immutable archive objects of any document kind. */
export type PdfArchiveObjectMetadata = Record<string, string>;

export type ImmutablePdfObject = {
  bucket: string;
  key: string;
  generation: string;
  sha256: string;
  customMetadata: PdfArchiveObjectMetadata & { pdf_sha256: string };
};

/** Hard ceiling for a read link handed to a caller. Longer requests are clamped to it. */
export const PDF_READ_LINK_MAX_TTL_SECONDS = 15 * 60;

@Injectable()
export class PdfStorage {
  private readonly logger = new Logger(PdfStorage.name);
  private readonly storage: Storage;

  constructor() {
    const credentials = process.env.GCP_CREDENTIALS;
    if (credentials) {
      try {
        const parsedCredentials = JSON.parse(credentials) as Record<
          string,
          unknown
        >;
        this.storage = new Storage({
          credentials: parsedCredentials,
        });
        this.logger.log(
          'Storage client initialized with GCP_CREDENTIALS from env',
        );
      } catch (err) {
        this.logger.error(
          'Failed to parse GCP_CREDENTIALS from environment',
          err,
        );
        this.storage = new Storage();
      }
    } else {
      this.storage = new Storage();
    }
  }

  async uploadPdf(params: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<{ bucket: string; key: string; etag: string | null }> {
    SideEffectGuard.assertAllowed('GCS_WRITE');
    return Sentry.startSpan(
      { name: 'Upload PDF to GCS', op: 'pdf.storage.upload' },
      async (span) => {
        const bucketName = this.getBucketName();
        span.setAttribute('bucket', bucketName);
        span.setAttribute('key', params.key);

        const bucket = this.storage.bucket(bucketName);
        const file = bucket.file(params.key);

        try {
          await file.save(params.body, {
            contentType: params.contentType,
            resumable: false,
          });

          return {
            bucket: bucketName,
            key: params.key,
            etag: null,
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to upload PDF to GCS (bucket=${bucketName}, key=${params.key}): ${message}`,
            error instanceof Error ? error.stack : undefined,
          );
          throw new InternalServerErrorException(
            'Failed to upload PDF to storage',
          );
        }
      },
    );
  }

  async publishImmutablePdf(params: {
    key: string;
    body: Buffer;
    contentType: string;
    customMetadata: PdfArchiveIdentityMetadata;
  }): Promise<ImmutablePdfArchive> {
    return (await this.publishImmutableObject(params)) as ImmutablePdfArchive;
  }

  /**
   * Create-only publication: `ifGenerationMatch: 0` means an existing object is
   * never overwritten. A losing writer gets the 412 error and can adopt the
   * winner with `readImmutableObjectByKey`.
   */
  async publishImmutableObject(params: {
    key: string;
    body: Buffer;
    contentType: string;
    customMetadata: PdfArchiveObjectMetadata;
  }): Promise<ImmutablePdfObject> {
    SideEffectGuard.assertAllowed('GCS_WRITE');
    const bucketName = this.getBucketName();
    const file = this.storage.bucket(bucketName).file(params.key);
    const sha256 = hashPdfBytes(params.body);
    const customMetadata = { ...params.customMetadata, pdf_sha256: sha256 };

    try {
      await file.save(params.body, {
        contentType: params.contentType,
        resumable: false,
        validation: 'crc32c',
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          cacheControl: 'private, no-store',
          metadata: customMetadata,
        },
      });

      const [metadata] = await file.getMetadata();
      const generation = metadata.generation
        ? String(metadata.generation)
        : null;
      const storedCustomMetadata = metadata.metadata as
        Record<string, string> | undefined;
      if (
        !generation ||
        !hasExpectedMetadata(storedCustomMetadata, customMetadata)
      ) {
        throw new InternalServerErrorException(
          'Immutable PDF archive metadata could not be verified',
        );
      }

      return {
        bucket: bucketName,
        key: params.key,
        generation,
        sha256,
        customMetadata,
      };
    } catch (error) {
      if (isGenerationPreconditionFailure(error)) {
        throw error;
      }
      if (error instanceof InternalServerErrorException) {
        throw error;
      }

      this.logger.error(
        `Failed to publish immutable PDF archive (bucket=${bucketName}, key=${params.key})`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException(
        'Failed to publish immutable PDF archive',
      );
    }
  }

  async readImmutablePdfGeneration(params: {
    bucket: string;
    key: string;
    generation: string;
    expectedSha256: string;
  }): Promise<ImmutablePdfArchive & { body: Buffer }> {
    return (await this.readImmutableObjectGeneration({
      ...params,
      validateMetadata: hasArchiveIdentityMetadata,
    })) as ImmutablePdfArchive & { body: Buffer };
  }

  async readImmutableObjectGeneration(params: {
    bucket: string;
    key: string;
    generation: string;
    expectedSha256: string;
    validateMetadata: (metadata: PdfArchiveObjectMetadata) => boolean;
  }): Promise<ImmutablePdfObject & { body: Buffer }> {
    const file = this.storage
      .bucket(params.bucket)
      .file(params.key, { generation: params.generation });

    try {
      const [metadata] = await file.getMetadata();
      const generation = metadata.generation
        ? String(metadata.generation)
        : null;
      if (generation !== params.generation) {
        throw new InternalServerErrorException(
          'Immutable PDF archive generation could not be verified',
        );
      }

      const customMetadata = (metadata.metadata ??
        {}) as PdfArchiveObjectMetadata;
      if (
        !params.validateMetadata(customMetadata) ||
        customMetadata.pdf_sha256 !== params.expectedSha256
      ) {
        throw new InternalServerErrorException(
          'Immutable PDF archive checksum metadata could not be verified',
        );
      }

      const [body] = await file.download();
      const sha256 = hashPdfBytes(body);
      if (sha256 !== params.expectedSha256) {
        throw new InternalServerErrorException(
          'Immutable PDF archive checksum could not be verified',
        );
      }

      return {
        bucket: params.bucket,
        key: params.key,
        generation,
        sha256,
        customMetadata: customMetadata as ImmutablePdfObject['customMetadata'],
        body,
      };
    } catch (error) {
      throw this.toGenerationReadError(error, params);
    }
  }

  /** Maps a failed generation read to the error the caller sees. */
  private toGenerationReadError(
    error: unknown,
    params: { bucket: string; key: string; generation: string },
  ): Error {
    if (error instanceof NotFoundException) {
      return error;
    }
    if (getStorageErrorCode(error) === 404) {
      return new NotFoundException('PDF archive generation not found');
    }
    if (error instanceof InternalServerErrorException) {
      return error;
    }

    this.logger.error(
      `Failed to read immutable PDF archive (bucket=${params.bucket}, key=${params.key}, generation=${params.generation})`,
      error instanceof Error ? error.stack : undefined,
    );
    return new InternalServerErrorException(
      'Failed to read immutable PDF archive',
    );
  }

  async readImmutablePdfByKey(params: {
    bucket: string;
    key: string;
    expectedIdentity: PdfArchiveIdentityMetadata;
  }): Promise<ImmutablePdfArchive & { body: Buffer }> {
    return (await this.readImmutableObjectByKey({
      bucket: params.bucket,
      key: params.key,
      validateMetadata: (metadata) =>
        hasExpectedMetadata(metadata, params.expectedIdentity) &&
        hasArchiveIdentityMetadata(metadata),
    })) as ImmutablePdfArchive & { body: Buffer };
  }

  /** Adopts the object currently stored at `key`, but only if its metadata validates. */
  async readImmutableObjectByKey(params: {
    bucket: string;
    key: string;
    validateMetadata: (metadata: PdfArchiveObjectMetadata) => boolean;
  }): Promise<ImmutablePdfObject & { body: Buffer }> {
    try {
      const file = this.storage.bucket(params.bucket).file(params.key);
      const [metadata] = await file.getMetadata();
      const generation = metadata.generation
        ? String(metadata.generation)
        : null;
      const customMetadata = (metadata.metadata ??
        {}) as PdfArchiveObjectMetadata;
      if (!generation || !params.validateMetadata(customMetadata)) {
        throw new InternalServerErrorException(
          'Immutable PDF archive identity could not be verified',
        );
      }

      const archive = await this.readImmutableObjectGeneration({
        bucket: params.bucket,
        key: params.key,
        generation,
        expectedSha256: customMetadata.pdf_sha256,
        validateMetadata: params.validateMetadata,
      });
      if (!params.validateMetadata(archive.customMetadata)) {
        throw new InternalServerErrorException(
          'Immutable PDF archive identity changed during verification',
        );
      }
      return archive;
    } catch (error) {
      throw this.toObjectReadError(error);
    }
  }

  /** Maps a failed read by key to the error the caller sees. */
  private toObjectReadError(error: unknown): Error {
    if (getStorageErrorCode(error) === 404) {
      return new NotFoundException('PDF archive object not found');
    }
    if (
      error instanceof NotFoundException ||
      error instanceof InternalServerErrorException
    ) {
      return error;
    }
    return new InternalServerErrorException(
      'Failed to verify immutable PDF archive object',
    );
  }

  async getPdfStream(params: { bucket?: string; key: string }): Promise<{
    bucket: string;
    key: string;
    stream: Readable;
    contentType: string | null;
    contentLength: number | null;
  }> {
    const bucketName = params.bucket ?? this.getBucketName();
    const bucket = this.storage.bucket(bucketName);
    const file = bucket.file(params.key);

    try {
      const [exists] = await file.exists();
      if (!exists) {
        throw new NotFoundException('PDF not found in storage');
      }

      const [metadata] = await file.getMetadata();

      return {
        bucket: bucketName,
        key: params.key,
        stream: file.createReadStream(),
        contentType: (metadata.contentType as string) ?? null,
        contentLength: metadata.size ? Number(metadata.size) : null,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to fetch PDF from GCS (bucket=${bucketName}, key=${params.key}): ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException(
        'Failed to fetch PDF from storage',
      );
    }
  }

  /**
   * Short-lived read link for one stored PDF. The URL is a bearer credential
   * that needs no session, so callers must take bucket and key from a row they
   * have already scoped to the tenant, and must never log the returned URL.
   * The TTL is clamped to PDF_READ_LINK_MAX_TTL_SECONDS.
   */
  async createSignedReadUrl(params: {
    bucket?: string | null;
    key: string;
    filename: string;
    ttlSeconds?: number;
  }): Promise<{ url: string; expiresAt: Date }> {
    const bucketName = params.bucket ?? this.getBucketName();
    const requested = params.ttlSeconds ?? PDF_READ_LINK_MAX_TTL_SECONDS;
    const ttlSeconds = Math.min(
      Math.max(Math.floor(requested), 1),
      PDF_READ_LINK_MAX_TTL_SECONDS,
    );
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const safeFilename = params.filename.replace(/["\r\n]+/g, '_');

    try {
      const [url] = await this.storage
        .bucket(bucketName)
        .file(params.key)
        .getSignedUrl({
          version: 'v4',
          action: 'read',
          expires: expiresAt,
          responseType: 'application/pdf',
          responseDisposition: `inline; filename="${safeFilename}"`,
        });
      return { url, expiresAt };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to sign PDF read link (bucket=${bucketName}, key=${params.key}): ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException(
        'Failed to create PDF download link',
      );
    }
  }

  private getBucketName(): string {
    return resolvePdfStorageBucket();
  }
}

function hashPdfBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function hasExpectedMetadata(
  actual: Record<string, string> | undefined,
  expected: Record<string, string>,
): boolean {
  return Object.entries(expected).every(
    ([key, value]) => actual?.[key] === value,
  );
}

function hasArchiveIdentityMetadata(
  metadata: PdfArchiveObjectMetadata | undefined,
): boolean {
  return Boolean(
    metadata?.tenant_id &&
    metadata.invoice_id &&
    metadata.snapshot_sha256 &&
    metadata.template_version &&
    metadata.pdf_sha256,
  );
}

function getStorageErrorCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code = error.code;
  if (typeof code === 'number') return code;
  if (typeof code === 'string') return Number(code);
  return undefined;
}

function isGenerationPreconditionFailure(error: unknown): boolean {
  return getStorageErrorCode(error) === 412;
}
