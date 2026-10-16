import sharp, { type Sharp } from 'sharp';
import type {
  ProcessUploadImageOptions,
  ProcessUploadImageResult,
  ProcessedImageVariant,
  UploadImageResizeLimits,
} from './image-processing.types.js';

export const DEFAULT_UPLOAD_IMAGE_LIMIT_INPUT_PIXELS = 16_000_000;
const DEFAULT_JPEG_QUALITY = 85;

async function toJpegVariant(
  pipeline: Sharp,
  limits: UploadImageResizeLimits,
  jpegQuality: number,
): Promise<ProcessedImageVariant> {
  const result = await pipeline
    .clone()
    .resize({
      width: limits.maxWidth,
      height: limits.maxHeight,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: jpegQuality, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  return {
    bytes: result.data,
    width: result.info.width,
    height: result.info.height,
    contentType: 'image/jpeg',
  };
}

/**
 * Normalises a user-uploaded photo: auto-rotate from EXIF, resize, re-encode as
 * JPEG without metadata. Opt-in helper for future check-in and listing uploads.
 */
export async function processUploadImage(
  input: Buffer,
  options: ProcessUploadImageOptions,
): Promise<ProcessUploadImageResult> {
  const jpegQuality = options.jpegQuality ?? DEFAULT_JPEG_QUALITY;
  const limitInputPixels =
    options.limitInputPixels ?? DEFAULT_UPLOAD_IMAGE_LIMIT_INPUT_PIXELS;

  const oriented = sharp(input, {
    limitInputPixels,
    failOn: 'warning',
  }).rotate();

  const main = await toJpegVariant(oriented, options.main, jpegQuality);
  const thumbnail = options.thumbnail
    ? await toJpegVariant(oriented, options.thumbnail, jpegQuality)
    : undefined;

  return { main, thumbnail };
}
