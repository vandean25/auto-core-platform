import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { DEFAULT_UPLOAD_IMAGE_LIMIT_INPUT_PIXELS } from '../../common/media/image-processing.js';

export const VEHICLE_MEDIA_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function requireVehiclePhotoUpload(
  file: Express.Multer.File | undefined,
): Buffer {
  if (!file?.buffer?.length) {
    throw new BadRequestException('A photo file upload is required.');
  }
  if (
    file.size > VEHICLE_MEDIA_MAX_UPLOAD_BYTES ||
    file.buffer.byteLength > VEHICLE_MEDIA_MAX_UPLOAD_BYTES
  ) {
    throw new PayloadTooLargeException({
      code: 'VEHICLE_PHOTO_TOO_LARGE',
      message: 'Vehicle photo exceeds the 10 MiB upload limit.',
    });
  }
  return file.buffer;
}

export function detectVehiclePhotoMimeType(bytes: Buffer): string {
  if (
    bytes.length >= PNG_SIGNATURE.length &&
    bytes.subarray(0, 8).equals(PNG_SIGNATURE)
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return 'application/octet-stream';
}

export function assertVehiclePhotoMimeType(mimeType: string): void {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new UnsupportedMediaTypeException({
      code: 'VEHICLE_PHOTO_TYPE_UNSUPPORTED',
      message: 'Vehicle photos must be JPEG, PNG, or WebP.',
    });
  }
}

export const VEHICLE_MEDIA_MAX_INPUT_PIXELS =
  DEFAULT_UPLOAD_IMAGE_LIMIT_INPUT_PIXELS;
