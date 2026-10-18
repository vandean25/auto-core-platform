import { UnprocessableEntityException } from '@nestjs/common';
import sharp from 'sharp';
import type { DocumentBrandingPdfParser } from './document-branding-pdf-parser.js';

const MAX_IMAGE_SIDE = 8192;
const MAX_IMAGE_PIXELS = 16_000_000;
const MAX_LOGO_SIDE = 1024;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export type ValidatedBrandAssetBytes = {
  bytes: Buffer;
  width: number;
  height: number;
  pagePreviewPng?: Buffer;
};

export function invalidBrandAsset(code: string) {
  return new UnprocessableEntityException({
    code,
    message: 'Document branding asset failed validation.',
  });
}

export function isBrandAssetValidationError(error: unknown): boolean {
  return error instanceof UnprocessableEntityException;
}

export function readBrandAssetValidationCode(error: unknown): string {
  if (error instanceof UnprocessableEntityException) {
    const response = error.getResponse();
    if (response && typeof response === 'object' && 'code' in response) {
      return String(response.code);
    }
  }
  return 'BRAND_ASSET_INVALID';
}

function isImageLimitError(error: unknown): boolean {
  return error instanceof Error && /pixel limit/i.test(error.message);
}

export async function validateBrandAssetBytes(
  pdfParser: DocumentBrandingPdfParser,
  purpose: 'SOURCE' | 'LOGO',
  mimeType: string | null,
  original: Buffer,
): Promise<ValidatedBrandAssetBytes> {
  if (mimeType === 'application/pdf' && purpose === 'SOURCE') {
    const pdf = await pdfParser.validateAndRasterize(original);
    return {
      bytes: original,
      width: pdf.width,
      height: pdf.height,
      pagePreviewPng: pdf.raster,
    };
  }
  if (mimeType !== 'image/png') {
    throw invalidBrandAsset('BRAND_FILE_TYPE_UNSUPPORTED');
  }

  try {
    const image = sharp(original, {
      limitInputPixels: MAX_IMAGE_PIXELS,
      failOn: 'warning',
    });
    const metadata = await image.metadata();
    if (
      metadata.format !== 'png' ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > MAX_IMAGE_SIDE ||
      metadata.height > MAX_IMAGE_SIDE ||
      metadata.width * metadata.height > MAX_IMAGE_PIXELS
    ) {
      throw invalidBrandAsset('BRAND_PNG_DIMENSIONS_INVALID');
    }

    if (purpose === 'SOURCE') {
      await image.clone().raw().toBuffer();
      return {
        bytes: original,
        width: metadata.width,
        height: metadata.height,
      };
    }
    const { data, info } = await image
      .resize({
        width: MAX_LOGO_SIDE,
        height: MAX_LOGO_SIDE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });
    if (data.byteLength > MAX_LOGO_BYTES) {
      throw invalidBrandAsset('BRAND_LOGO_TOO_LARGE');
    }
    return { bytes: data, width: info.width, height: info.height };
  } catch (error) {
    if (isBrandAssetValidationError(error)) throw error;
    if (isImageLimitError(error)) {
      throw invalidBrandAsset('BRAND_PNG_DIMENSIONS_INVALID');
    }
    throw invalidBrandAsset('BRAND_PNG_INVALID');
  }
}
