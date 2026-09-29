import sharp from 'sharp';
import { DocumentBrandingExtractionImageProcessor } from './document-branding-extraction-image-processor.js';

describe('DocumentBrandingExtractionImageProcessor', () => {
  const processor = new DocumentBrandingExtractionImageProcessor();

  it('downscales, re-encodes and strips metadata from PNG input', async () => {
    const source = await sharp({
      create: {
        width: 4096,
        height: 1024,
        channels: 4,
        background: '#123456',
      },
    })
      .withMetadata({ exif: { IFD0: { Make: 'Sensitive camera' } } })
      .png()
      .toBuffer();

    const normalized = await processor.normalizePng(source);
    const metadata = await sharp(normalized.bytes).metadata();

    expect({ width: metadata.width, height: metadata.height }).toEqual({
      width: 2048,
      height: 512,
    });
    expect(metadata.exif).toBeUndefined();
  });

  it('crops and bounds a derived logo from a normalized raster', async () => {
    const source = await sharp({
      create: {
        width: 2000,
        height: 1000,
        channels: 4,
        background: '#123456',
      },
    })
      .png()
      .toBuffer();

    const logo = await processor.cropLogo(source, {
      x: 0.25,
      y: 0.1,
      width: 0.5,
      height: 0.8,
    });
    const metadata = await sharp(logo.bytes).metadata();

    expect({ width: metadata.width, height: metadata.height }).toEqual({
      width: 1000,
      height: 800,
    });
    expect(logo.bytes.byteLength).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it('rejects an input whose longest side exceeds 8192 pixels', async () => {
    const source = await sharp({
      create: {
        width: 8193,
        height: 1,
        channels: 4,
        background: '#123456',
      },
    })
      .png()
      .toBuffer();

    await expect(processor.normalizePng(source)).rejects.toMatchObject({
      response: { code: 'BRAND_IMAGE_DIMENSIONS_INVALID' },
    });
  });
});
