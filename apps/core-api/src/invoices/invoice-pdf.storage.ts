import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';

@Injectable()
export class InvoicePdfStorage {
  private readonly logger = new Logger(InvoicePdfStorage.name);
  private client: S3Client | null = null;

  async uploadPdf(params: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<{ bucket: string; key: string; etag: string | null }> {
    const bucket = this.getBucket();
    const client = this.getClient();

    try {
      const result = await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: params.key,
          Body: params.body,
          ContentType: params.contentType,
        }),
      );
      return { bucket, key: params.key, etag: result.ETag ?? null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to upload invoice PDF to S3 (bucket=${bucket}, key=${params.key}): ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException(
        'Failed to upload invoice PDF to storage',
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
    const bucket = params.bucket ?? this.getBucket();
    const client = this.getClient();

    try {
      const result = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: params.key }),
      );

      const body = result.Body;
      if (!(body instanceof Readable)) {
        throw new InternalServerErrorException(
          'Storage returned an unexpected payload type',
        );
      }

      return {
        bucket,
        key: params.key,
        stream: body,
        contentType: result.ContentType ?? null,
        contentLength: result.ContentLength ?? null,
      };
    } catch (error) {
      const httpStatus = this.getHttpStatusCode(error);
      const name = this.getErrorName(error);
      if (httpStatus === 404 || name === 'NoSuchKey') {
        throw new NotFoundException('Invoice PDF not found in storage');
      }

      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to fetch invoice PDF from S3 (bucket=${bucket}, key=${params.key}): ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException(
        'Failed to fetch invoice PDF from storage',
      );
    }
  }

  private getBucket(): string {
    const bucket = process.env.INVOICE_PDF_BUCKET;
    if (!bucket) {
      throw new InternalServerErrorException(
        'INVOICE_PDF_BUCKET environment variable is not configured',
      );
    }
    return bucket;
  }

  private getClient(): S3Client {
    if (this.client) {
      return this.client;
    }

    const region =
      process.env.S3_REGION ?? process.env.AWS_REGION ?? 'us-east-1';
    const endpoint = process.env.S3_ENDPOINT;
    const forcePathStyle =
      process.env.S3_FORCE_PATH_STYLE === 'true' ||
      process.env.S3_FORCE_PATH_STYLE === '1';

    const accessKeyId =
      process.env.S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey =
      process.env.S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;

    this.client = new S3Client({
      region,
      endpoint: endpoint || undefined,
      forcePathStyle,
      credentials:
        accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey }
          : undefined,
    });

    return this.client;
  }

  private getHttpStatusCode(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') {
      return undefined;
    }

    const maybeMetadata = (error as Record<string, unknown>)['$metadata'];
    if (!maybeMetadata || typeof maybeMetadata !== 'object') {
      return undefined;
    }

    const code = (maybeMetadata as Record<string, unknown>)['httpStatusCode'];
    return typeof code === 'number' ? code : undefined;
  }

  private getErrorName(error: unknown): string | undefined {
    if (!error || typeof error !== 'object') {
      return undefined;
    }

    const name = (error as Record<string, unknown>)['name'];
    return typeof name === 'string' ? name : undefined;
  }
}
