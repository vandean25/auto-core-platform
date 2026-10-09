import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const BUNDLED_FONT_FILES = [
  'NotoSans-Regular.woff2',
  'NotoSans-Bold.woff2',
  'NotoSans-LatinExt-Regular.woff2',
  'NotoSans-LatinExt-Bold.woff2',
];

/**
 * Embeds the bundled brand fonts as data URLs for offline PDF rendering.
 * Returns null when a font file is missing or its checksum does not match the
 * manifest, so callers can fail closed with their own error.
 */
export async function loadBundledBrandFontCss(
  assetDirectory: string,
): Promise<string | null> {
  try {
    const [fontFiles, manifestFile] = await Promise.all([
      Promise.all(
        BUNDLED_FONT_FILES.map((fontName) =>
          readFile(resolve(assetDirectory, fontName)),
        ),
      ),
      readFile(resolve(assetDirectory, 'font-manifest.json')),
    ]);
    const manifest = JSON.parse(manifestFile.toString('utf8')) as {
      files?: Record<string, string>;
    };
    const checksumsMatch = fontFiles.every(
      (font, index) =>
        manifest.files?.[BUNDLED_FONT_FILES[index] ?? ''] ===
        `sha256:${createHash('sha256').update(font).digest('hex')}`,
    );
    if (!manifest.files || !checksumsMatch) {
      return null;
    }
    const [regular, bold, regularExtended, boldExtended] = fontFiles.map(
      (font) => `data:font/woff2;base64,${font.toString('base64')}`,
    );
    return `
        @font-face { font-family: 'ACP Sans'; font-style: normal; font-weight: 400; src: url('${regular}') format('woff2'); }
        @font-face { font-family: 'ACP Sans'; font-style: normal; font-weight: 700; src: url('${bold}') format('woff2'); }
        @font-face { font-family: 'ACP Sans'; font-style: normal; font-weight: 400; src: url('${regularExtended}') format('woff2'); unicode-range: U+0100-024F, U+1E00-1EFF; }
        @font-face { font-family: 'ACP Sans'; font-style: normal; font-weight: 700; src: url('${boldExtended}') format('woff2'); unicode-range: U+0100-024F, U+1E00-1EFF; }
      `;
  } catch {
    return null;
  }
}
