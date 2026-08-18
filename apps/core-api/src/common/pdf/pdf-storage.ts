import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Storage } from '@google-cloud/storage';
import { Readable } from 'node:stream';
import * as Sentry from '@sentry/node';
import { resolvePdfStorageBucket } from './pdf-bucket';

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
