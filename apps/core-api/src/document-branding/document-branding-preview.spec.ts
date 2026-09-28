import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createDocumentBrandPreview } from './document-branding-preview.js';
import { DEFAULT_DOCUMENT_BRAND_THEME } from './theme-v1.js';

describe('createDocumentBrandPreview', () => {
  it('matches the bundled font checksum manifest and includes Latin Extended weights', () => {
    const manifest = JSON.parse(
      readFileSync(
        new URL('./assets/font-manifest.json', import.meta.url),
        'utf8',
      ),
    ) as { files: Record<string, string> };
    for (const [filename, expected] of Object.entries(manifest.files)) {
      const digest = createHash('sha256')
        .update(readFileSync(new URL(`./assets/${filename}`, import.meta.url)))
        .digest('hex');
      expect(`sha256:${digest}`).toBe(expected);
    }
    const preview = createDocumentBrandPreview(
      DEFAULT_DOCUMENT_BRAND_THEME,
      'AT_STANDARD',
    );
    expect(preview.html.match(/unicode-range:/g)).toHaveLength(2);
  });

  it('shows clipping warnings for the same measured two-line header and one-line footer limits', () => {
    const preview = createDocumentBrandPreview(
      {
        ...DEFAULT_DOCUMENT_BRAND_THEME,
        headerText: 'W'.repeat(120),
        footerText: 'REPAIR SHOP '.repeat(10),
      },
      'AT_STANDARD',
      'data:image/png;base64,AA==',
    );
    expect(preview.warnings).toEqual([
      'HEADER_TEXT_MAY_BE_CLIPPED',
      'FOOTER_TEXT_MAY_BE_CLIPPED',
    ]);
    expect(preview.html).toContain('text-overflow:ellipsis');
    expect(preview.html).toContain('-webkit-line-clamp:2');
  });

  it('embeds the bundled regular and bold Noto Sans fonts without network sources', () => {
    const preview = createDocumentBrandPreview(
      DEFAULT_DOCUMENT_BRAND_THEME,
      'AT_STANDARD',
    );
    expect(preview.html).toContain(
      "font-family:'Noto Sans';font-style:normal;font-weight:400",
    );
    expect(preview.html).toContain(
      "font-family:'Noto Sans';font-style:normal;font-weight:700",
    );
    expect(preview.html).toContain('data:font/woff2;base64,');
    expect(preview.html).not.toMatch(/https?:\/\//);
    expect(preview.html).not.toContain('Arial');
    expect(preview.html).not.toContain('sans-serif');
  });

  it('renders only the approved synthetic sample and identifies it as a sample', () => {
    const preview = createDocumentBrandPreview(
      DEFAULT_DOCUMENT_BRAND_THEME,
      'AT_STANDARD',
    );

    expect(preview.html).toContain('SAMPLE — NOT AN INVOICE');
    expect(preview.html).toContain('RE-2026-0001');
    expect(preview.html).toContain('Content-Security-Policy');
    expect(preview.html).toContain("default-src 'none'");
    expect(preview.themeHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('escapes decorative text before embedding it in preview markup', () => {
    const preview = createDocumentBrandPreview(
      { ...DEFAULT_DOCUMENT_BRAND_THEME, headerText: 'R&D "service"' },
      'DE_STANDARD',
    );

    expect(preview.html).toContain('R&amp;D &quot;service&quot;');
    expect(preview.html).not.toContain('R&D "service"');
  });
});
