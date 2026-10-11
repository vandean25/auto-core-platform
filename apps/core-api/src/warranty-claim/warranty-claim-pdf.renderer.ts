import { Injectable, Logger } from '@nestjs/common';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Sentry from '@sentry/node';
import { PlaywrightBrowserService } from '../common/index.js';
import { loadBundledBrandFontCss } from '../document-branding/bundled-brand-font-css.js';
import { brandRenderInputUnavailable } from '../invoices/invoice-pdf-branding.helpers.js';
import {
  buildWarrantyClaimFooterTemplate,
  buildWarrantyClaimHeaderTemplate,
  buildWarrantyClaimHtml,
  type WarrantyClaimPdfContent,
} from './warranty-claim-pdf.layout.js';

const RENDER_TIMEOUT_MS = 15_000;

@Injectable()
export class WarrantyClaimPdfRenderer {
  private readonly logger = new Logger(WarrantyClaimPdfRenderer.name);
  private readonly assetDirectory = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../document-branding/assets',
  );

  constructor(private readonly browserService: PlaywrightBrowserService) {}

  async render(content: WarrantyClaimPdfContent): Promise<Buffer> {
    const fonts = await this.loadFontCss();

    return Sentry.startSpan(
      { name: 'Render warranty claim PDF', op: 'pdf.render' },
      async () => {
        const browser = await this.browserService.getBrowser();
        const page = await browser.newPage();

        try {
          // The document is self-contained: no network access while rendering.
          await page.route(/^https?:\/\//, (route) => route.abort());
          await page.setContent(
            buildWarrantyClaimHtml(content, { fontFaceCss: fonts }),
            {
              timeout: 10_000,
            },
          );

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
              headerTemplate: buildWarrantyClaimHeaderTemplate(content, fonts),
              footerTemplate: buildWarrantyClaimFooterTemplate(content, fonts),
              printBackground: true,
            }),
            RENDER_TIMEOUT_MS,
            'Warranty claim PDF render timed out after 15 seconds',
          );

          return Buffer.from(pdf);
        } finally {
          await page.close().catch((error: unknown) => {
            const message =
              error instanceof Error ? error.message : String(error);
            this.logger.error(
              `Failed to close page during warranty claim PDF render cleanup: ${message}`,
            );
          });
        }
      },
    );
  }

  private async loadFontCss(): Promise<string> {
    const css = await loadBundledBrandFontCss(this.assetDirectory);
    if (!css) {
      throw brandRenderInputUnavailable('Bundled brand fonts are unavailable.');
    }
    return css;
  }
}
