import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { processUploadImage } from './image-processing.js';

const gpsFixture = new URL('./fixtures/gps-oriented.jpg', import.meta.url);

describe('processUploadImage', () => {
  it('strips EXIF and GPS metadata from a fixture JPEG', async () => {
    const source = await readFile(gpsFixture);
    const before = await sharp(source).metadata();
    expect(before.exif).toBeDefined();
    expect(before.orientation).toBe(6);

    const { main } = await processUploadImage(source, {
      main: { maxWidth: 2048, maxHeight: 2048 },
    });
    const after = await sharp(main.bytes).metadata();

    expect(after.exif).toBeUndefined();
    expect(after.orientation).toBeUndefined();
    expect(after.iptc).toBeUndefined();
    expect(after.xmp).toBeUndefined();
  });

  it('applies EXIF orientation before stripping metadata', async () => {
    const source = await readFile(gpsFixture);
    const inputMeta = await sharp(source).metadata();
    expect(inputMeta.width).toBe(120);
    expect(inputMeta.height).toBe(80);

    const { main } = await processUploadImage(source, {
      main: { maxWidth: 2048, maxHeight: 2048 },
    });

    expect({ width: main.width, height: main.height }).toEqual({
      width: 80,
      height: 120,
    });
  });

  it('respects configurable max dimensions and thumbnail bounds', async () => {
    const source = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: '#336699',
      },
    })
      .jpeg()
      .toBuffer();

    const { main, thumbnail } = await processUploadImage(source, {
      main: { maxWidth: 400, maxHeight: 300 },
      thumbnail: { maxWidth: 120, maxHeight: 90 },
    });

    expect({ width: main.width, height: main.height }).toEqual({
      width: 400,
      height: 300,
    });
    expect(thumbnail).toBeDefined();
    expect({ width: thumbnail!.width, height: thumbnail!.height }).toEqual({
      width: 120,
      height: 90,
    });
    expect(main.contentType).toBe('image/jpeg');
    expect(thumbnail!.contentType).toBe('image/jpeg');
  });

  it('does not enlarge images smaller than the configured bounds', async () => {
    const source = await sharp({
      create: {
        width: 200,
        height: 100,
        channels: 3,
        background: '#abcdef',
      },
    })
      .jpeg()
      .toBuffer();

    const { main } = await processUploadImage(source, {
      main: { maxWidth: 1024, maxHeight: 1024 },
    });

    expect({ width: main.width, height: main.height }).toEqual({
      width: 200,
      height: 100,
    });
  });
});
