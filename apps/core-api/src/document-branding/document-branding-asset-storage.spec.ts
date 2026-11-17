import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUNDLED_DEMO_BRANDING_BUCKET,
  BUNDLED_DEMO_LOGO_GENERATION,
  BUNDLED_DEMO_LOGO_OBJECT_KEY,
  DocumentBrandingAssetStorage,
} from './document-branding-asset-storage.js';

describe('DocumentBrandingAssetStorage', () => {
  it('reads the bundled demo logo PNG from disk without calling GCS', async () => {
    const storage = new DocumentBrandingAssetStorage();
    const expectedPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      'assets',
      'demo-workshop-logo.png',
    );
    const expectedBytes = await readFile(expectedPath);
    const expectedSha256 = createHash('sha256')
      .update(expectedBytes)
      .digest('hex');

    const bytes = await storage.readGeneration(
      BUNDLED_DEMO_BRANDING_BUCKET,
      BUNDLED_DEMO_LOGO_OBJECT_KEY,
      BUNDLED_DEMO_LOGO_GENERATION,
    );

    expect(bytes.equals(expectedBytes)).toBe(true);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      expectedSha256,
    );
  });

  it('skips GCS deletion for the bundled demo branding bucket', async () => {
    const storage = new DocumentBrandingAssetStorage();

    await expect(
      storage.deleteGeneration(
        BUNDLED_DEMO_BRANDING_BUCKET,
        BUNDLED_DEMO_LOGO_OBJECT_KEY,
        BUNDLED_DEMO_LOGO_GENERATION,
      ),
    ).resolves.toBeUndefined();
  });
});
