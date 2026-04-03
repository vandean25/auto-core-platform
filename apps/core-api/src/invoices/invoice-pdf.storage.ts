import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Storage } from '@google-cloud/storage';
import { Readable } from 'node:stream';
import * as Sentry from '@sentry/node';

@Injectable()
export class InvoicePdfStorage {
  private readonly logger = new Logger(InvoicePdfStorage.name);
  private readonly storage: Storage;

  constructor() {
    this.storage = new Storage();
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
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to upload invoice PDF to GCS (bucket=${bucketName}, key=${params.key}): ${message}`,
            error instanceof Error ? error.stack : undefined,
          );
          throw new InternalServerErrorException(
            'Failed to upload invoice PDF to storage',
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
        throw new NotFoundException('Invoice PDF not found in storage');
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
        `Failed to fetch invoice PDF from GCS (bucket=${bucketName}, key=${params.key}): ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException(
        'Failed to fetch invoice PDF from storage',
      );
    }
  }

  private getBucketName(): string {
    const bucket = process.env.INVOICE_PDF_BUCKET;
    if (!bucket) {
      throw new InternalServerErrorException(
        'INVOICE_PDF_BUCKET environment variable is not configured',
      );
    }
    return bucket;
  }
}
