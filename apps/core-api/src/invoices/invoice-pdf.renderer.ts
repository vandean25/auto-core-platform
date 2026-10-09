import {
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Sentry from '@sentry/node';
import { PlaywrightBrowserService } from '../common/index.js';
import { loadBundledBrandFontCss } from '../document-branding/bundled-brand-font-css.js';
import { escapeHtml } from '../common/pdf/pdf-layout.js';
import type { InvoiceSnapshot } from './invoice-snapshot.js';
import {
  buildInvoiceFooterTemplate,
  buildInvoiceHtmlDocument,
  buildBrandedInvoiceHeaderTemplate,
  isDachRechnungSnapshot,
  type FormatDate,
} from './invoice-pdf.layout.js';

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
      throw this.renderInputUnavailable();
    }
    const fontFaceCss = branded ? await this.loadBundledFontCss() : '';
    const logoDataUrl = branded
      ? this.resolveLogoDataUrl(snapshot, assets.logoPng)
      : null;

    return Sentry.startSpan(
      { name: 'Render PDF', op: 'pdf.render' },
      async () => {
        const invoiceNumber = snapshot.invoice_number ?? snapshot.id;
        const browser = await this.browserService.getBrowser();
        const page = await browser.newPage();

        try {
          if (branded) {
            await page.route(/^https?:\/\//, (route) => route.abort());
          }

          const formatDate: FormatDate = (value) =>
            this.formatDateValue(value, isDachRechnungSnapshot(snapshot));
          const html = buildInvoiceHtmlDocument(
            snapshot,
            invoiceNumber,
            escapeHtml,
            formatDate,
            {
              branded,
              fontFaceCss,
            },
          );
          await page.setContent(html, { timeout: 10_000 });

          const pdf = await Sentry.startSpan(
            { name: 'Render Page to PDF', op: 'pdf.browser.render' },
            () =>
              this.browserService.withTimeout(
                page.pdf({
                  format: 'A4',
                  margin: branded
                    ? {
                        top: '32mm',
                        right: '16mm',
                        bottom: '28mm',
                        left: '16mm',
                      }
                    : {
                        top: '50px',
                        right: '50px',
                        bottom: '70px',
                        left: '50px',
                      },
                  displayHeaderFooter: true,
                  headerTemplate: branded
                    ? buildBrandedInvoiceHeaderTemplate(
                        snapshot,
                        logoDataUrl,
                        escapeHtml,
                        fontFaceCss,
                      )
                    : '<div></div>',
                  footerTemplate: buildInvoiceFooterTemplate(
                    invoiceNumber,
                    escapeHtml,
                    snapshot,
                    fontFaceCss,
                  ),
                  printBackground: true,
                }),
                15_000,
                'Invoice PDF render timed out after 15 seconds',
              ),
          );

          return Buffer.from(pdf);
        } finally {
          await page.close().catch((error) => {
            const message =
              error instanceof Error ? error.message : String(error);
            const stack = error instanceof Error ? error.stack : undefined;
            this.logger.error(
              `Failed to close page during PDF render cleanup: ${message}`,
              stack,
            );
          });
        }
      },
    );
  }

  private resolveLogoDataUrl(
    snapshot: InvoiceSnapshot,
    logoPng: Buffer | undefined,
  ): string | null {
    const logo = snapshot.branding?.logo;
    if (!logo) return null;
    if (
      !logoPng ||
      createHash('sha256').update(logoPng).digest('hex') !== logo.sha256
    ) {
      throw this.renderInputUnavailable();
    }
    return `data:image/png;base64,${logoPng.toString('base64')}`;
  }

  private async loadBundledFontCss(): Promise<string> {
    const css = await loadBundledBrandFontCss(this.assetDirectory);
    if (!css) {
      throw this.renderInputUnavailable();
    }
    return css;
  }

  private renderInputUnavailable(): UnprocessableEntityException {
    return new UnprocessableEntityException({
      code: 'BRAND_RENDER_INPUT_UNAVAILABLE',
      message: 'Frozen branding render inputs are unavailable.',
    });
  }

  private formatDateValue(value: string | Date, useGermanLocale: boolean) {
    const date = typeof value === 'string' ? new Date(value) : value;
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    if (useGermanLocale) {
      return date.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    }

    return date.toISOString().slice(0, 10);
  }
}
