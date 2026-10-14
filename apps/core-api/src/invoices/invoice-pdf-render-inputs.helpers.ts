import { UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { loadBundledBrandFontCss } from '../document-branding/bundled-brand-font-css.js';
import type { InvoiceSnapshot } from './invoice-snapshot.js';

export function createRenderInputUnavailableError(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'BRAND_RENDER_INPUT_UNAVAILABLE',
    message: 'Frozen branding render inputs are unavailable.',
  });
}

/**
 * Returns the frozen logo as a PNG data URL, or null when the branding has no
 * logo. Fails closed when the logo bytes are missing or do not match the
 * checksum frozen into the snapshot.
 */
export function resolveInvoiceLogoDataUrl(
  snapshot: InvoiceSnapshot,
  logoPng: Buffer | undefined,
): string | null {
  const logo = snapshot.branding?.logo;
  if (!logo) return null;
  if (
    !logoPng ||
    createHash('sha256').update(logoPng).digest('hex') !== logo.sha256
  ) {
    throw createRenderInputUnavailableError();
  }
  return `data:image/png;base64,${logoPng.toString('base64')}`;
}

/**
 * Loads the bundled brand font CSS from the asset directory. Fails closed when
 * the font files or their manifest are missing or do not match.
 */
export async function loadInvoiceFontFaceCss(
  assetDirectory: string,
): Promise<string> {
  const css = await loadBundledBrandFontCss(assetDirectory);
  if (!css) {
    throw createRenderInputUnavailableError();
  }
  return css;
}
