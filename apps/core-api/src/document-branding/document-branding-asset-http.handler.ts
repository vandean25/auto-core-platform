import type { Response } from 'express';
import type { DocumentBrandingUploadService } from './document-branding-upload.service.js';
import { withQuotaRetryAfter } from './document-branding-quota-http.js';
import {
  streamAssetPagePreview,
  streamReadyAssetContent,
} from './document-branding-asset-http.js';

export function uploadBrandingAsset(
  uploads: DocumentBrandingUploadService,
  legalEntityId: string,
  purpose: string,
  file: Express.Multer.File | undefined,
  response: Response,
) {
  return withQuotaRetryAfter(
    () => uploads.upload(legalEntityId, purpose, file),
    response,
    'BRAND_UPLOAD_QUOTA_EXCEEDED',
    60 * 60,
  );
}

export function getBrandingAssetMetadata(
  uploads: DocumentBrandingUploadService,
  legalEntityId: string,
  assetId: string,
) {
  return uploads.getAsset(legalEntityId, assetId);
}

export async function streamBrandingAssetContent(
  uploads: DocumentBrandingUploadService,
  legalEntityId: string,
  assetId: string,
) {
  const content = await uploads.getAssetContent(legalEntityId, assetId);
  const metadata = await uploads.getAsset(legalEntityId, assetId);
  return streamReadyAssetContent({
    bytes: content.bytes,
    contentType: content.contentType,
    purpose: content.purpose,
    originalFilename: metadata.originalFilename,
  });
}

export async function streamBrandingAssetPagePreview(
  uploads: DocumentBrandingUploadService,
  legalEntityId: string,
  assetId: string,
) {
  const preview = await uploads.getAssetPagePreview(legalEntityId, assetId);
  return streamAssetPagePreview(preview.bytes);
}
