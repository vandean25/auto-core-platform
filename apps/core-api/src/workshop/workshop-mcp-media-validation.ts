import { BadRequestException } from '@nestjs/common';
import { WorkshopMediaPurpose } from '@prisma/client';
import { MAX_IMAGE_BYTES } from '../mechanic/dto/media.dto.js';

/** Image MIME types allowed for MCP workshop media upload slots (AUT-598). */
export const MCP_WORKSHOP_MEDIA_UPLOAD_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
] as const;

export const MCP_WORKSHOP_MEDIA_UPLOAD_PURPOSES = [
  'MECHANIC_FINDING',
  'CHECK_IN',
] as const;

export type McpWorkshopMediaUploadPurpose =
  (typeof MCP_WORKSHOP_MEDIA_UPLOAD_PURPOSES)[number];

export function resolveMcpWorkshopMediaPurpose(
  purpose: McpWorkshopMediaUploadPurpose,
): WorkshopMediaPurpose {
  if (purpose === 'CHECK_IN') {
    return WorkshopMediaPurpose.CHECK_IN;
  }
  return WorkshopMediaPurpose.GENERAL;
}

/** Declared MIME and size for a direct-to-storage workshop media upload slot. */
export function assertMcpWorkshopMediaUploadDeclared(
  mimeType: string,
  sizeBytes: number,
): void {
  if (
    !(MCP_WORKSHOP_MEDIA_UPLOAD_MIME_TYPES as readonly string[]).includes(
      mimeType,
    )
  ) {
    throw new BadRequestException(
      `Unsupported mime_type: ${mimeType}. Allowed: ${MCP_WORKSHOP_MEDIA_UPLOAD_MIME_TYPES.join(', ')}`,
    );
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes < 1) {
    throw new BadRequestException('size_bytes must be a positive integer');
  }
  if (sizeBytes > MAX_IMAGE_BYTES) {
    throw new BadRequestException(
      `Declared file size ${sizeBytes} bytes exceeds the maximum allowed for images (${MAX_IMAGE_BYTES} bytes).`,
    );
  }
}
