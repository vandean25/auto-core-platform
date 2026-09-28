import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { validateDocumentBrandTheme } from './theme-v1.js';

export type DocumentBrandSample = 'AT_STANDARD' | 'DE_STANDARD';

const SAMPLE_INVOICES: Record<
  DocumentBrandSample,
  { number: string; country: string; total: string }
> = {
  AT_STANDARD: {
    number: 'RE-2026-0001',
    country: 'Austria',
    total: '€ 1.200,00',
  },
  DE_STANDARD: {
    number: 'RE-2026-0002',
    country: 'Germany',
    total: '€ 1.200,00',
  },
};

const PAGE_WIDTH_PX = 794;
const HORIZONTAL_MARGIN_PX = 60;
const LOGO_WIDTH_PX = 170;
const DECORATIVE_TEXT_FONT_PX = 12;
const REGULAR_FONT_PATH = fileURLToPath(
  new URL('./assets/NotoSans-Regular.woff2', import.meta.url),
);
GlobalFonts.registerFromPath(REGULAR_FONT_PATH, 'Noto Sans');
GlobalFonts.registerFromPath(
  fileURLToPath(
    new URL('./assets/NotoSans-LatinExt-Regular.woff2', import.meta.url),
  ),
  'Noto Sans',
);
const REGULAR_FONT = readBundledFont('NotoSans-Regular.woff2');
const BOLD_FONT = readBundledFont('NotoSans-Bold.woff2');
const LATIN_EXT_REGULAR_FONT = readBundledFont(
  'NotoSans-LatinExt-Regular.woff2',
);
const LATIN_EXT_BOLD_FONT = readBundledFont('NotoSans-LatinExt-Bold.woff2');

export function createDocumentBrandPreview(
  input: unknown,
  sample: DocumentBrandSample,
  logoDataUri?: string,
) {
  const theme = validateDocumentBrandTheme(input);
  const invoice = SAMPLE_INVOICES[sample];
  const headerText = escapeHtml(theme.headerText).replace(/\n/g, '<br>');
  const footerText = escapeHtml(theme.footerText);
  const availableWidth = PAGE_WIDTH_PX - 2 * HORIZONTAL_MARGIN_PX;
  const headerWidth = availableWidth - (logoDataUri ? LOGO_WIDTH_PX : 0);
  const warnings = [
    ...(wrapDecorativeText(theme.headerText, headerWidth).length > 2
      ? ['HEADER_TEXT_MAY_BE_CLIPPED']
      : []),
    ...(measureTextWidth(theme.footerText) > availableWidth
      ? ['FOOTER_TEXT_MAY_BE_CLIPPED']
      : []),
  ];
  const logo = logoDataUri
    ? `<img class="logo" src="${logoDataUri}" alt="Company logo">`
    : '';
  const clippingWarning =
    warnings.length > 0
      ? '<p class="overflow-warning">Decorative text may be clipped in the issued document.</p>'
      : '';
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      @font-face{font-family:'Noto Sans';font-style:normal;font-weight:400;src:url(data:font/woff2;base64,${REGULAR_FONT}) format('woff2')}
      @font-face{font-family:'Noto Sans';font-style:normal;font-weight:700;src:url(data:font/woff2;base64,${BOLD_FONT}) format('woff2')}
      @font-face{font-family:'Noto Sans';font-style:normal;font-weight:400;unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF;src:url(data:font/woff2;base64,${LATIN_EXT_REGULAR_FONT}) format('woff2')}
      @font-face{font-family:'Noto Sans';font-style:normal;font-weight:700;unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF;src:url(data:font/woff2;base64,${LATIN_EXT_BOLD_FONT}) format('woff2')}
      *{box-sizing:border-box}body{margin:0;background:#f1f5f9;color:#111827;font:14px 'Noto Sans'}
      .sheet{position:relative;width:794px;min-height:1123px;margin:16px auto;background:#fff;padding:181px 60px 167px;box-shadow:0 2px 12px #0002}
      .band{height:11px;background:${bandColor(theme.headerBand, theme.primaryColor, theme.secondaryColor)};position:absolute;left:60px;right:60px;top:64px}
      .header{position:absolute;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;left:60px;right:${logoDataUri ? 60 + LOGO_WIDTH_PX : 60}px;top:78px;color:${theme.primaryColor};font-size:12px;line-height:1.4;max-height:34px;overflow:hidden;overflow-wrap:anywhere}
      .logo{position:absolute;right:60px;top:78px;width:170px;height:68px;object-fit:contain}
      .content{border-bottom:1px solid #e5e7eb;padding:18px 0}.label{color:#64748b;font-size:11px}
      .footer{position:absolute;left:60px;right:60px;bottom:54px;color:#475569;font-size:12px;line-height:1.4;white-space:nowrap;text-overflow:ellipsis;max-height:17px;overflow:hidden}
      .footer-band{height:11px;background:${bandColor(theme.footerBand, theme.primaryColor, theme.secondaryColor)};position:absolute;left:60px;right:60px;bottom:38px}
      h1{font-size:24px;color:${theme.primaryColor};margin:0 0 32px}p{margin:0 0 8px}
      .overflow-warning{position:absolute;bottom:12px;left:60px;font-size:10px;color:#92400e}
    </style>
  </head>
  <body>
    <main class="sheet" aria-label="Sample invoice preview">
      <div class="band"></div><header class="header">${headerText}</header>${logo}
      <h1>Invoice</h1>
      <section class="content"><p class="label">SAMPLE — NOT AN INVOICE</p><p>Example Customer</p><p>Sample Street 1</p><p>1010 ${escapeHtml(invoice.country)}</p></section>
      <section class="content"><p><strong>${invoice.number}</strong></p><p>Sample workshop service</p><p class="label">Net amount</p><p>€ 1.000,00</p><p class="label">Tax</p><p>€ 200,00</p><p><strong>Total ${invoice.total}</strong></p></section>
      ${clippingWarning}<footer class="footer">${footerText}</footer><div class="footer-band"></div>
    </main>
  </body>
</html>`;
  const themeHash = createHash('sha256')
    .update(JSON.stringify(theme))
    .digest('hex');
  return { html, warnings, themeHash };
}

function readBundledFont(filename: string): string {
  return readFileSync(
    new URL(`./assets/${filename}`, import.meta.url),
  ).toString('base64');
}

function measureTextWidth(text: string): number {
  const context = createCanvas(1, 1).getContext('2d');
  context.font = `${DECORATIVE_TEXT_FONT_PX}px "Noto Sans"`;
  return context.measureText(text).width;
}

function wrapDecorativeText(text: string, maxWidth: number): string[] {
  const context = createCanvas(1, 1).getContext('2d');
  context.font = `${DECORATIVE_TEXT_FONT_PX}px "Noto Sans"`;
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      for (const character of word) {
        const partial = line + character;
        if (context.measureText(partial).width > maxWidth && line) {
          lines.push(line);
          line = character;
        } else {
          line = partial;
        }
      }
    }
    lines.push(line);
  }
  return lines;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function bandColor(
  band: 'none' | 'primary' | 'secondary',
  primary: string,
  secondary: string,
): string {
  if (band === 'primary') return primary;
  if (band === 'secondary') return secondary;
  return 'transparent';
}
