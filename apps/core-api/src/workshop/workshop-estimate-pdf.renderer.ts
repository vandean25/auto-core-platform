import { Injectable, Logger } from '@nestjs/common';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Sentry from '@sentry/node';
import { PlaywrightBrowserService } from '../common/index.js';
import { escapeHtml } from '../common/pdf/pdf-layout.js';
import { loadBundledBrandFontCss } from '../document-branding/bundled-brand-font-css.js';
import { brandRenderInputUnavailable } from '../invoices/invoice-pdf-branding.helpers.js';
import {
  buildWorkshopEstimateFooterTemplate,
  buildWorkshopEstimateHeaderTemplate,
  buildWorkshopEstimateHtmlDocument,
} from './workshop-estimate-pdf.layout.js';
import type { WorkshopEstimateSnapshot } from './workshop-estimate-snapshot.js';

export type WorkshopEstimateRenderInput = {
  snapshot: WorkshopEstimateSnapshot;
  /** Frozen logo bytes. The caller has checked them against the snapshot hash. */
  logoPng?: Buffer;
};

@Injectable()
export class WorkshopEstimatePdfRenderer {
  private readonly logger = new Logger(WorkshopEstimatePdfRenderer.name);
  private readonly assetDirectory = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../document-branding/assets',
  );

  constructor(private readonly browserService: PlaywrightBrowserService) {}

  async render({
    snapshot,
    logoPng,
  }: WorkshopEstimateRenderInput): Promise<Buffer> {
    const logoDataUrl = this.resolveLogoDataUrl(snapshot, logoPng);
    const fontFaceCss = await this.loadBundledFontCss();

    return Sentry.startSpan(
      { name: 'Render Workshop Estimate PDF', op: 'pdf.render' },
      async () => {
        const browser = await this.browserService.getBrowser();
        const page = await browser.newPage();

        try {
          // Fonts and the logo are embedded, so the document never fetches a URL.
          await page.route(/^https?:\/\//, (route) => route.abort());

          const html = buildWorkshopEstimateHtmlDocument(
            snapshot,
            fontFaceCss,
            escapeHtml,
          );
          await page.setContent(html, { timeout: 10_000 });

          const pdf = await Sentry.startSpan(
            { name: 'Render Page to PDF', op: 'pdf.browser.render' },
            () =>
              this.browserService.withTimeout(
                page.pdf({
                  format: 'A4',
                  margin: {
                    top: '32mm',
                    right: '16mm',
                    bottom: '28mm',
                    left: '16mm',
                  },
                  displayHeaderFooter: true,
                  headerTemplate: buildWorkshopEstimateHeaderTemplate(
                    snapshot,
                    logoDataUrl,
                    escapeHtml,
                    fontFaceCss,
                  ),
                  footerTemplate: buildWorkshopEstimateFooterTemplate(
                    snapshot,
                    escapeHtml,
                    fontFaceCss,
                  ),
                  printBackground: true,
                }),
                15_000,
                'Estimate PDF render timed out after 15 seconds',
              ),
          );

          return Buffer.from(pdf);
        } finally {
          await page.close().catch((error) => {
            const message =
              error instanceof Error ? error.message : String(error);
            const stack = error instanceof Error ? error.stack : undefined;
            this.logger.error(
              `Failed to close page during estimate PDF render cleanup: ${message}`,
              stack,
            );
          });
        }
      },
    );
  }

  private resolveLogoDataUrl(
    snapshot: WorkshopEstimateSnapshot,
    logoPng: Buffer | undefined,
  ): string | null {
    if (!snapshot.branding.logo) return null;
    if (!logoPng) {
      throw brandRenderInputUnavailable();
    }
    return `data:image/png;base64,${logoPng.toString('base64')}`;
  }

  private async loadBundledFontCss(): Promise<string> {
    const css = await loadBundledBrandFontCss(this.assetDirectory);
    if (!css) {
      throw brandRenderInputUnavailable();
    }
    return css;
  }
}
