import { Injectable, Logger } from '@nestjs/common';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Sentry from '@sentry/node';
import type { Page } from 'playwright';
import { PlaywrightBrowserService } from '../common/index.js';
import { escapeHtml } from '../common/pdf/pdf-layout.js';
import { createInvoicePdfDateFormatter } from './invoice-pdf-date-format.helpers.js';
import { buildInvoiceHtmlDocumentForSnapshot } from './invoice-pdf-localized.layout.js';
import { resolveInvoicePdfLayoutContext } from './invoice-pdf-layout-context.js';
import {
  createRenderInputUnavailableError,
  loadInvoiceFontFaceCss,
  resolveInvoiceLogoDataUrl,
} from './invoice-pdf-render-inputs.helpers.js';
import { buildInvoicePdfOptions } from './invoice-pdf-render-options.helpers.js';
import type { InvoiceSnapshot } from './invoice-snapshot.js';

interface RenderPageInput {
  snapshot: InvoiceSnapshot;
  branded: boolean;
  fontFaceCss: string;
  logoDataUrl: string | null;
}

@Injectable()
export class InvoicePdfRenderer {
  private readonly logger = new Logger(InvoicePdfRenderer.name);
  private readonly assetDirectory = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../document-branding/assets',
  );

  constructor(private readonly browserService: PlaywrightBrowserService) {}

  async render(
    snapshot: InvoiceSnapshot,
    assets: { logoPng?: Buffer } = {},
  ): Promise<Buffer> {
    const branded = snapshot.template_version === 'invoice-brand-v1';
    if (branded && !snapshot.branding) {
      throw createRenderInputUnavailableError();
    }
    const fontFaceCss = branded
      ? await loadInvoiceFontFaceCss(this.assetDirectory)
      : '';
    const logoDataUrl = branded
      ? resolveInvoiceLogoDataUrl(snapshot, assets.logoPng)
      : null;

    return Sentry.startSpan(
      { name: 'Render PDF', op: 'pdf.render' },
      async () => {
        const browser = await this.browserService.getBrowser();
        const page = await browser.newPage();

        try {
          return await this.renderPage(page, {
            snapshot,
            branded,
            fontFaceCss,
            logoDataUrl,
          });
        } finally {
          await this.closePage(page);
        }
      },
    );
  }

  private async renderPage(
    page: Page,
    { snapshot, branded, fontFaceCss, logoDataUrl }: RenderPageInput,
  ): Promise<Buffer> {
    const invoiceNumber = snapshot.invoice_number ?? snapshot.id;
    if (branded) {
      await page.route(/^https?:\/\//, (route) => route.abort());
    }

    const formatDate = createInvoicePdfDateFormatter(snapshot);
    const html = buildInvoiceHtmlDocumentForSnapshot(
      snapshot,
      invoiceNumber,
      escapeHtml,
      formatDate,
      resolveInvoicePdfLayoutContext(snapshot),
      { branded, fontFaceCss },
    );
    await page.setContent(html, { timeout: 10_000 });

    const pdf = await Sentry.startSpan(
      { name: 'Render Page to PDF', op: 'pdf.browser.render' },
      () =>
        this.browserService.withTimeout(
          page.pdf(
            buildInvoicePdfOptions({
              snapshot,
              invoiceNumber,
              branded,
              logoDataUrl,
              fontFaceCss,
            }),
          ),
          15_000,
          'Invoice PDF render timed out after 15 seconds',
        ),
    );

    return Buffer.from(pdf);
  }

  private async closePage(page: Page): Promise<void> {
    await page.close().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Failed to close page during PDF render cleanup: ${message}`,
        stack,
      );
    });
  }
}
