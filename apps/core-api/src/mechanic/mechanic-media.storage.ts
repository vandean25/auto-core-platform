import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Storage } from '@google-cloud/storage';
import {
  ALLOWED_MEDIA_MIME_TYPES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  UPLOAD_POLICY_TTL_SECONDS,
  type AllowedMediaMimeType,
} from './dto/media.dto';

export interface GenerateUploadPolicyParams {
  tenantId: string;
  orderId: string;
  taskId: string;
  mimeType: AllowedMediaMimeType;
  /** Declared file size — used for the upper bound of content-length-range. */
  sizeBytes: number;
  /** Optional original filename hint, used to derive the storage key extension. */
  filename?: string;
}

export interface UploadPolicyResult {
  uploadUrl: string;
  formFields: Record<string, string>;
  storageBucket: string;
  storageKey: string;
  expiresAt: Date;
}

export const IMAGE_MIME_TYPES = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

/**
 * Provides GCS presigned POST policy generation for mechanic media uploads.
 *
 * Policies enforce:
 *   - `content-length-range` — prevents oversized uploads at the storage layer.
 *   - MIME type — explicitly whitelisted per ADR-0014 §7.1.
 *   - Short expiry — default 15 minutes.
 *   - Tenant/order/task-scoped object key prefix.
 */
@Injectable()
export class MechanicMediaStorage {
  private readonly logger = new Logger(MechanicMediaStorage.name);
  private readonly storage: Storage;

  constructor() {
    const credentials = process.env.GCP_CREDENTIALS;
    if (credentials) {
      try {
        const parsedCredentials = JSON.parse(credentials) as Record<
          string,
          unknown
        >;
        this.storage = new Storage({ credentials: parsedCredentials });
        this.logger.log(
          'MechanicMediaStorage: GCS client initialised with GCP_CREDENTIALS',
        );
      } catch (err) {
        this.logger.error(
          'MechanicMediaStorage: failed to parse GCP_CREDENTIALS',
          err,
        );
        this.storage = new Storage();
      }
    } else {
      this.storage = new Storage();
    }
  }

  /**
   * Generates a short-lived GCS signed POST policy V4 that the client uses to
   * upload a file directly to cloud storage without routing the binary through
   * the backend.
   *
   * Enforced constraints (ADR-0014 §7.1):
   *   - MIME type must be in the whitelist.
   *   - `content-length-range` caps the maximum upload to the declared size
   *     and the per-class hard cap (50 MB images / 200 MB videos).
   *   - Object key is scoped to `tenants/{tenantId}/orders/{orderId}/tasks/{taskId}/`.
   *   - Policy expires in 15 minutes.
   */
  async generateUploadPolicy(
    params: GenerateUploadPolicyParams,
  ): Promise<UploadPolicyResult> {
    const { tenantId, orderId, taskId, mimeType, sizeBytes, filename } = params;

    if (!(ALLOWED_MEDIA_MIME_TYPES as readonly string[]).includes(mimeType)) {
      throw new BadRequestException(
        `Unsupported MIME type: ${mimeType}. Allowed: ${ALLOWED_MEDIA_MIME_TYPES.join(', ')}`,
      );
    }

    const isImage = IMAGE_MIME_TYPES.has(mimeType);
    const hardCap = isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;

    if (sizeBytes > hardCap) {
      throw new BadRequestException(
        `Declared file size ${sizeBytes} bytes exceeds the maximum allowed for ${mimeType} (${hardCap} bytes).`,
      );
    }

    const bucketName = this.getBucketName();
    const ext = this.getExtension(mimeType, filename);
    const objectId = crypto.randomUUID();
    const storageKey = `tenants/${tenantId}/orders/${orderId}/tasks/${taskId}/${objectId}${ext}`;

    const expiresAt = new Date(Date.now() + UPLOAD_POLICY_TTL_SECONDS * 1000);

    const bucket = this.storage.bucket(bucketName);
    const file = bucket.file(storageKey);

    try {
      const [policy] = await file.generateSignedPostPolicyV4({
        expires: expiresAt,
        conditions: [
          // Enforce minimum 1 byte to prevent empty file uploads.
          ['content-length-range', 1, sizeBytes],
          // Lock the MIME type to what the client declared.
          ['eq', '$Content-Type', mimeType],
        ],
        fields: {
          'Content-Type': mimeType,
        },
      });

      return {
        uploadUrl: policy.url,
        formFields: policy.fields,
        storageBucket: bucketName,
        storageKey,
        expiresAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to generate signed POST policy for key=${storageKey}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException(
        'Failed to generate media upload policy. Please try again.',
      );
    }
  }

  private getBucketName(): string {
    const bucket = process.env.WORKSHOP_MEDIA_BUCKET;
    if (!bucket) {
      throw new InternalServerErrorException(
        'WORKSHOP_MEDIA_BUCKET environment variable is not configured.',
      );
    }
    return bucket;
  }

  private getExtension(mimeType: string, filename?: string): string {
    const mimeExtMap: Record<string, readonly string[]> = {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/webp': ['.webp'],
      'video/mp4': ['.mp4'],
      'video/quicktime': ['.mov'],
    };

    const allowedExtensions = mimeExtMap[mimeType];
    if (!allowedExtensions || allowedExtensions.length === 0) {
      return '';
    }

    if (filename) {
      const dotIdx = filename.lastIndexOf('.');
      if (dotIdx !== -1) {
        const filenameExtension = filename.slice(dotIdx).toLowerCase();
        if (allowedExtensions.includes(filenameExtension)) {
          return filenameExtension;
        }
      }
    }

    return allowedExtensions[0];
  }
}
