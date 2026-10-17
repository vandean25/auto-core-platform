import sharp from 'sharp';
import { reencodeCheckInSignaturePng } from './workshop-check-in-signature-upload.js';

describe('reencodeCheckInSignaturePng', () => {
  it('re-encodes PNG without retaining EXIF metadata', async () => {
    const source = await sharp({
      create: {
        width: 80,
        height: 40,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 0 },
      },
    })
      .png()
      .withMetadata({ density: 120 })
      .toBuffer();

    const output = await reencodeCheckInSignaturePng(source);
    const twice = await reencodeCheckInSignaturePng(output);
    expect(twice.equals(output)).toBe(true);
    const meta = await sharp(output).metadata();
    expect(meta.width).toBe(80);
    expect(meta.height).toBe(40);
  });
});
