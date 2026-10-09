import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Sentry from '@sentry/node';
import { PlaywrightBrowserService } from '../../common/index.js';
import { loadBundledBrandFontCss } from '../../document-branding/bundled-brand-font-css.js';
import { brandRenderInputUnavailable } from '../../invoices/invoice-pdf-branding.helpers.js';
import {
  buildKaufvertragFooterTemplate,
  buildKaufvertragHeaderTemplate,
  buildKaufvertragHtmlDocument,
} from './kaufvertrag-pdf.layout.js';
import type { KaufvertragSnapshot } from './kaufvertrag-snapshot.js';

const RENDER_TIMEOUT_MS = 15_000;

@Injectable()
export class KaufvertragPdfRenderer {
  private readonly logger = new Logger(KaufvertragPdfRenderer.name);
  private readonly assetDirectory = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../document-branding/assets',
  );

  constructor(private readonly browserService: PlaywrightBrowserService) {}

  async render(
    snapshot: KaufvertragSnapshot,
    assets: { logoPng?: Buffer } = {},
  ): Promise<Buffer> {
    const fontFaceCss = await this.loadFontCss();
    const logoDataUrl = this.resolveLogoDataUrl(snapshot, assets.logoPng);

    return Sentry.startSpan(
      { name: 'Render Kaufvertrag PDF', op: 'pdf.render' },
      async () => {
        const browser = await this.browserService.getBrowser();
        const page = await browser.newPage();

        try {
          // The document is self-contained: no network access while rendering.
          await page.route(/^https?:\/\//, (route) => route.abort());
          const html = buildKaufvertragHtmlDocument(snapshot, { fontFaceCss });
          await page.setContent(html, { timeout: 10_000 });

          const pdf = await this.browserService.withTimeout(
            page.pdf({
              format: 'A4',
              margin: {
                top: '32mm',
                right: '16mm',
                bottom: '26mm',
                left: '16mm',
              },
              displayHeaderFooter: true,
              headerTemplate: buildKaufvertragHeaderTemplate(
                snapshot,
                logoDataUrl,
                fontFaceCss,
              ),
              footerTemplate: buildKaufvertragFooterTemplate(
                snapshot,
                fontFaceCss,
              ),
              printBackground: true,
            }),
            RENDER_TIMEOUT_MS,
            'Kaufvertrag PDF render timed out after 15 seconds',
          );

          return Buffer.from(pdf);
        } finally {
          await page.close().catch((error) => {
            const message =
              error instanceof Error ? error.message : String(error);
            const stack = error instanceof Error ? error.stack : undefined;
            this.logger.error(
              `Failed to close page during Kaufvertrag PDF render cleanup: ${message}`,
              stack,
            );
          });
        }
      },
    );
  }

  private resolveLogoDataUrl(
    snapshot: KaufvertragSnapshot,
    logoPng: Buffer | undefined,
  ): string | null {
    const logo = snapshot.branding.logo;
    if (!logo) return null;
    if (
      !logoPng ||
      createHash('sha256').update(logoPng).digest('hex') !== logo.sha256
    ) {
      throw brandRenderInputUnavailable();
    }
    return `data:image/png;base64,${logoPng.toString('base64')}`;
  }

  private async loadFontCss(): Promise<string> {
    const css = await loadBundledBrandFontCss(this.assetDirectory);
    if (!css) {
      throw brandRenderInputUnavailable('Bundled brand fonts are unavailable.');
    }
    return css;
  }
}
