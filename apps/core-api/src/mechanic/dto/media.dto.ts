import { ApiProperty } from '@nestjs/swagger';
import { WorkshopMediaUrlStrategy } from '@prisma/client';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * Allowed MIME types for mechanic media uploads.
 * Presigned POST policy and media-persist endpoint both validate against this
 * list (ADR-0014 §7.1).
 */
export const ALLOWED_MEDIA_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
] as const;

export type AllowedMediaMimeType = (typeof ALLOWED_MEDIA_MIME_TYPES)[number];

/** 50 MB cap for images, 200 MB cap for videos (bytes). */
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

/** Presigned POST policy session expires after 15 minutes (seconds). */
export const UPLOAD_POLICY_TTL_SECONDS = 900;

/**
 * Request body for `POST /api/mechanic/tasks/:taskId/media/uploads`.
 *
 * The client declares the MIME type and file size before uploading.
 * The backend validates constraints and returns a short-lived presigned
 * POST policy for direct-to-storage upload (ADR-0014 §7.1).
 */
export class RequestMediaUploadDto {
  @ApiProperty({
    description: 'MIME type of the file to upload.',
    enum: ALLOWED_MEDIA_MIME_TYPES,
  })
  @IsIn(ALLOWED_MEDIA_MIME_TYPES)
  mimeType!: AllowedMediaMimeType;

  @ApiProperty({
    description:
      'Declared file size in bytes (used for content-length-range constraint).',
    minimum: 1,
  })
  @IsNumber()
  @IsPositive()
  sizeBytes!: number;

  @ApiProperty({
    description:
      'Optional original filename hint (used to derive the storage object extension).',
    required: false,
  })
  @IsString()
  @IsOptional()
  filename?: string;
}

/**
 * Response body for `POST /api/mechanic/tasks/:taskId/media/uploads`.
 *
 * Contains the presigned POST policy fields and upload URL needed by the
 * client to POST the file directly to cloud storage.
 *
 * The client must include all `formFields` as form-data fields alongside the
 * binary file payload.
 */
export class MediaUploadPolicyDto {
  @ApiProperty({ description: 'POST URL for the multipart form upload.' })
  uploadUrl!: string;

  @ApiProperty({
    description:
      'Form fields that must be submitted together with the file in the multipart upload.',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  formFields!: Record<string, string>;

  @ApiProperty({ description: 'Storage bucket name.' })
  storageBucket!: string;

  @ApiProperty({
    description:
      'Storage object key. Pass this to `POST /media` after upload completes.',
  })
  storageKey!: string;

  @ApiProperty({
    description: 'ISO-8601 expiry timestamp for the upload policy.',
  })
  expiresAt!: string;
}

/**
 * Request body for `POST /api/mechanic/tasks/:taskId/media`.
 *
 * Submitted by the client after the direct upload to storage completes, to
 * persist media metadata to the database (ADR-0014 §7.2).
 */
export class CreateMediaDto {
  @ApiProperty({
    description: 'Storage object key returned by the upload policy endpoint.',
  })
  @IsString()
  storageKey!: string;

  @ApiProperty({
    description: 'Storage bucket returned by the upload policy endpoint.',
  })
  @IsString()
  storageBucket!: string;

  @ApiProperty({
    description: 'MIME type of the uploaded file.',
    enum: ALLOWED_MEDIA_MIME_TYPES,
  })
  @IsIn(ALLOWED_MEDIA_MIME_TYPES)
  mimeType!: AllowedMediaMimeType;

  @ApiProperty({ description: 'File size in bytes.', minimum: 1 })
  @IsNumber()
  @IsPositive()
  @Max(MAX_VIDEO_BYTES)
  sizeBytes!: number;

  @ApiProperty({
    description: 'Optional caption for the media.',
    type: String,
    required: false,
    nullable: true,
  })
  @IsString()
  @IsOptional()
  caption?: string | null;

  @ApiProperty({
    description: 'Duration in seconds for video uploads.',
    type: Number,
    required: false,
    nullable: true,
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  durationSeconds?: number | null;
}

/**
 * Response DTO for a persisted `WorkshopMedia` record.
 */
export class WorkshopMediaDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  workshopOrderId!: string;

  @ApiProperty({ type: String, required: false, nullable: true })
  workshopTaskId?: string | null;

  @ApiProperty()
  uploadedByEmployeeId!: string;

  @ApiProperty()
  storageBucket!: string;

  @ApiProperty()
  storageKey!: string;

  @ApiProperty({ enum: WorkshopMediaUrlStrategy })
  urlStrategy!: WorkshopMediaUrlStrategy;

  @ApiProperty()
  mimeType!: string;

  @ApiProperty()
  sizeBytes!: number;

  @ApiProperty({ type: Number, required: false, nullable: true })
  durationSeconds?: number | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  caption?: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
