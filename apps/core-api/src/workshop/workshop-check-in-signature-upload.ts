import sharp from 'sharp';
import {
  CHECK_IN_SIGNATURE_MAX_BYTES,
  CHECK_IN_SIGNATURE_MAX_HEIGHT,
  CHECK_IN_SIGNATURE_MAX_WIDTH,
} from './workshop-check-in-signature-limits.js';

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export function assertCheckInSignaturePng(bytes: Buffer): void {
  if (bytes.length === 0 || bytes.length > CHECK_IN_SIGNATURE_MAX_BYTES) {
    throw new Error('CHECK_IN_SIGNATURE_SIZE');
  }
  if (bytes.subarray(0, 8).compare(PNG_SIGNATURE) !== 0) {
    throw new Error('CHECK_IN_SIGNATURE_FORMAT');
  }
}

export async function validateCheckInSignaturePngDimensions(
  bytes: Buffer,
): Promise<void> {
  const metadata = await sharp(bytes, { failOn: 'error' }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (
    width <= 0 ||
    height <= 0 ||
    width > CHECK_IN_SIGNATURE_MAX_WIDTH ||
    height > CHECK_IN_SIGNATURE_MAX_HEIGHT
  ) {
    throw new Error('CHECK_IN_SIGNATURE_DIMENSIONS');
  }
}

/** Lossless PNG re-encode drops ancillary metadata (EXIF, text chunks). */
export async function reencodeCheckInSignaturePng(
  bytes: Buffer,
): Promise<Buffer> {
  assertCheckInSignaturePng(bytes);
  await validateCheckInSignaturePngDimensions(bytes);
  const output = await sharp(bytes, { failOn: 'error' })
    .png({ compressionLevel: 9, adaptiveFiltering: true, force: true })
    .toBuffer();
  assertCheckInSignaturePng(output);
  if (output.length > CHECK_IN_SIGNATURE_MAX_BYTES) {
    throw new Error('CHECK_IN_SIGNATURE_SIZE');
  }
  return output;
}
