import sharp from 'sharp';

const MAX_INPUT_PIXELS = 16_000_000;
const MAX_INPUT_SIDE = 8_192;
const MAX_PROVIDER_SIDE = 2_048;
const MAX_LOGO_SIDE = 1_024;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

type CropRect = { x: number; y: number; width: number; height: number };
type WorkerRequest =
  | { mode: 'normalize'; bytes: Buffer }
  | { mode: 'crop'; bytes: Buffer; cropRect: CropRect | null };
type WorkerResponse =
  | { type: 'memory'; rss: number; heapUsed: number; external: number }
  | { type: 'result'; bytes: Buffer; width: number; height: number }
  | { type: 'error'; code: string };

process.on('message', (message: WorkerRequest) => {
  void processImage(message);
});

async function processImage(message: WorkerRequest): Promise<void> {
  const memoryTimer = setInterval(reportMemory, 100);
  try {
    const metadata = await readMetadata(message.bytes);
    if (metadata.format !== 'png') throw new ImageFailure('BRAND_PNG_INVALID');
    const dimensions = requireInputDimensions(metadata.width, metadata.height);
    const output =
      message.mode === 'normalize'
        ? await normalizeRaster(message.bytes)
        : await cropLogo(message.bytes, dimensions, message.cropRect);
    send({ type: 'result', ...output });
  } catch (error) {
    const code =
      error instanceof ImageFailure ? error.code : 'BRAND_PNG_INVALID';
    send({ type: 'error', code });
  } finally {
    clearInterval(memoryTimer);
    process.disconnect?.();
  }
}

async function readMetadata(bytes: Buffer) {
  try {
    return await sharp(bytes, {
      limitInputPixels: MAX_INPUT_PIXELS,
    }).metadata();
  } catch {
    throw new ImageFailure('BRAND_PNG_INVALID');
  }
}

function requireInputDimensions(width?: number, height?: number) {
  if (!width || !height || width > MAX_INPUT_SIDE || height > MAX_INPUT_SIDE) {
    throw new ImageFailure('BRAND_IMAGE_DIMENSIONS_INVALID');
  }
  if (width * height > MAX_INPUT_PIXELS) {
    throw new ImageFailure('BRAND_IMAGE_PIXELS_INVALID');
  }
  return { width, height };
}

async function normalizeRaster(bytes: Buffer) {
  const result = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
    .resize({
      width: MAX_PROVIDER_SIDE,
      height: MAX_PROVIDER_SIDE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true });
  if (
    result.info.width > MAX_PROVIDER_SIDE ||
    result.info.height > MAX_PROVIDER_SIDE ||
    result.info.width * result.info.height > MAX_PROVIDER_SIDE ** 2
  ) {
    throw new ImageFailure('BRAND_IMAGE_DIMENSIONS_INVALID');
  }
  return {
    bytes: result.data,
    width: result.info.width,
    height: result.info.height,
  };
}

async function cropLogo(
  bytes: Buffer,
  dimensions: { width: number; height: number },
  cropRect: CropRect | null,
) {
  const region = cropRect
    ? toPixelRegion(cropRect, dimensions)
    : { left: 0, top: 0, width: dimensions.width, height: dimensions.height };
  let image = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).extract(
    region,
  );
  const factor = Math.min(
    1,
    MAX_LOGO_SIDE / region.width,
    MAX_LOGO_SIDE / region.height,
  );
  if (factor < 1) {
    image = image.resize({
      width: Math.max(1, Math.floor(region.width * factor)),
      height: Math.max(1, Math.floor(region.height * factor)),
      fit: 'inside',
      withoutEnlargement: true,
    });
  }
  let output = await image.png({ compressionLevel: 9 }).toBuffer({
    resolveWithObject: true,
  });
  while (output.data.byteLength > MAX_LOGO_BYTES) {
    const nextWidth = Math.floor(output.info.width * 0.8);
    const nextHeight = Math.floor(output.info.height * 0.8);
    if (Math.min(nextWidth, nextHeight) < 32) {
      throw new ImageFailure('BRAND_DERIVED_LOGO_TOO_LARGE');
    }
    output = await sharp(output.data)
      .resize({ width: nextWidth, height: nextHeight, fit: 'inside' })
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });
  }
  return {
    bytes: output.data,
    width: output.info.width,
    height: output.info.height,
  };
}

function toPixelRegion(
  cropRect: CropRect,
  dimensions: { width: number; height: number },
) {
  if (
    !isUnitInterval(cropRect.x) ||
    !isUnitInterval(cropRect.y) ||
    !isPositiveUnitInterval(cropRect.width) ||
    !isPositiveUnitInterval(cropRect.height) ||
    cropRect.x + cropRect.width > 1 ||
    cropRect.y + cropRect.height > 1
  ) {
    throw new ImageFailure('BRAND_EXTRACTION_CROP_INVALID');
  }
  const left = Math.floor(cropRect.x * dimensions.width);
  const top = Math.floor(cropRect.y * dimensions.height);
  const right = Math.ceil((cropRect.x + cropRect.width) * dimensions.width);
  const bottom = Math.ceil((cropRect.y + cropRect.height) * dimensions.height);
  if (
    left < 0 ||
    top < 0 ||
    right > dimensions.width ||
    bottom > dimensions.height ||
    right <= left ||
    bottom <= top
  ) {
    throw new ImageFailure('BRAND_EXTRACTION_CROP_INVALID');
  }
  return { left, top, width: right - left, height: bottom - top };
}

function isUnitInterval(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function isPositiveUnitInterval(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= 1;
}

function reportMemory(): void {
  const { rss, heapUsed, external } = process.memoryUsage();
  send({ type: 'memory', rss, heapUsed, external });
}

function send(message: WorkerResponse): void {
  if (process.connected) process.send?.(message);
}

class ImageFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
