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

      const customMetadata = metadata.metadata as
        (PdfArchiveIdentityMetadata & { pdf_sha256?: string }) | undefined;
      if (
        !hasArchiveIdentityMetadata(customMetadata) ||
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
        customMetadata: customMetadata,
        body,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      if (getStorageErrorCode(error) === 404) {
        throw new NotFoundException('PDF archive generation not found');
      }
      if (error instanceof InternalServerErrorException) {
        throw error;
      }

      this.logger.error(
        `Failed to read immutable PDF archive (bucket=${params.bucket}, key=${params.key}, generation=${params.generation})`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException(
        'Failed to read immutable PDF archive',
      );
    }
  }

  async readImmutablePdfByKey(params: {
    bucket: string;
    key: string;
    expectedIdentity: PdfArchiveIdentityMetadata;
  }): Promise<ImmutablePdfArchive & { body: Buffer }> {
    try {
      const file = this.storage.bucket(params.bucket).file(params.key);
      const [metadata] = await file.getMetadata();
      const generation = metadata.generation
        ? String(metadata.generation)
        : null;
      const customMetadata = metadata.metadata as
        (PdfArchiveIdentityMetadata & { pdf_sha256?: string }) | undefined;
      if (
        !generation ||
        !hasExpectedMetadata(customMetadata, params.expectedIdentity) ||
        !hasArchiveIdentityMetadata(customMetadata)
      ) {
        throw new InternalServerErrorException(
          'Immutable PDF archive identity could not be verified',
        );
      }

      const archive = await this.readImmutablePdfGeneration({
        bucket: params.bucket,
        key: params.key,
        generation,
        expectedSha256: customMetadata.pdf_sha256,
      });
      if (
        !hasExpectedMetadata(archive.customMetadata, params.expectedIdentity)
      ) {
        throw new InternalServerErrorException(
          'Immutable PDF archive identity changed during verification',
        );
      }
      return archive;
    } catch (error) {
      if (getStorageErrorCode(error) === 404) {
        throw new NotFoundException('PDF archive object not found');
      }
      if (
        error instanceof NotFoundException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to verify immutable PDF archive object',
      );
    }
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
  metadata: (PdfArchiveIdentityMetadata & { pdf_sha256?: string }) | undefined,
): metadata is ImmutablePdfArchive['customMetadata'] {
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
