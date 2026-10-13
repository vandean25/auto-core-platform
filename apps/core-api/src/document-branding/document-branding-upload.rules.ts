import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  DOCUMENT_BRAND_LOGO_MAX_BYTES,
  DOCUMENT_BRAND_SOURCE_MAX_BYTES,
  formatLogoUploadRequirement,
  formatSourceUploadRequirement,
} from './document-branding-limits.js';

export type DocumentBrandPurpose = 'SOURCE' | 'LOGO';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function requirePurpose(value: string): DocumentBrandPurpose {
  if (value !== 'SOURCE' && value !== 'LOGO') {
    throw new BadRequestException('Asset purpose must be SOURCE or LOGO.');
  }
  return value;
}

export function requireUpload(
  file: Express.Multer.File | undefined,
  purpose: DocumentBrandPurpose,
) {
  if (!file?.buffer?.length) {
    throw new BadRequestException('A file upload is required.');
  }
  const limit =
    purpose === 'LOGO'
      ? DOCUMENT_BRAND_LOGO_MAX_BYTES
      : DOCUMENT_BRAND_SOURCE_MAX_BYTES;
  if (file.size > limit || file.buffer.byteLength > limit) {
    throw new PayloadTooLargeException({
      code: 'BRAND_UPLOAD_TOO_LARGE',
      message: 'Document branding upload exceeds its size limit.',
    });
  }
  return file.buffer;
}

export function assertPurposeSupportsMime(
  purpose: DocumentBrandPurpose,
  detectedMimeType: string,
) {
  if (purpose === 'LOGO' && detectedMimeType !== 'image/png') {
    throw new UnsupportedMediaTypeException({
      code: 'BRAND_FILE_TYPE_UNSUPPORTED',
      message: formatLogoUploadRequirement(),
    });
  }
  if (
    purpose === 'SOURCE' &&
    detectedMimeType !== 'image/png' &&
    detectedMimeType !== 'application/pdf'
  ) {
    throw new UnsupportedMediaTypeException({
      code: 'BRAND_FILE_TYPE_UNSUPPORTED',
      message: formatSourceUploadRequirement(),
    });
  }
}

export function detectMimeType(bytes: Buffer): string {
  if (
    bytes.length >= PNG_SIGNATURE.length &&
    bytes.subarray(0, 8).equals(PNG_SIGNATURE)
  ) {
    return 'image/png';
  }
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'application/pdf';
  }
  return 'application/octet-stream';
}

export function sanitizeFilename(filename: string): string | null {
  const normalized = filename
    .normalize('NFC')
    .replace(/[\\/\p{Cc}\p{Cf}"]/gu, ' ')
    .trim()
    .slice(0, 255);
  return normalized.length > 0 ? normalized : null;
}

export function buildContentDisposition(
  disposition: 'attachment' | 'inline',
  filename: string,
): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename);
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export type DocumentBrandAssetSummary = {
  id: string;
  purpose: string;
  state: string;
  detected_mime_type: string | null;
  byte_length: number;
  pixel_width: number | null;
  pixel_height: number | null;
  failure_code: string | null;
  original_filename: string | null;
  preview_object_key: string | null;
  createdAt: Date;
  expires_at: Date | null;
};

export function mapDocumentBrandAssetResponse(
  asset: DocumentBrandAssetSummary,
) {
  return {
    id: asset.id,
    purpose: asset.purpose,
    state: asset.state,
    detectedMimeType: asset.detected_mime_type,
    byteLength: asset.byte_length,
    pixelWidth: asset.pixel_width,
    pixelHeight: asset.pixel_height,
    failureCode: asset.failure_code,
    originalFilename: asset.original_filename,
    pagePreviewAvailable: Boolean(asset.preview_object_key),
    createdAt: asset.createdAt,
    expiresAt: asset.expires_at,
  };
}
