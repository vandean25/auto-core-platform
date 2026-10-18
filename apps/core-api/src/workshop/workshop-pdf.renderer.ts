import { Injectable, Logger } from '@nestjs/common';
import type { DisplayLanguage } from '@prisma/client';
import type { PdfRenderMode } from '../common/i18n/pdf-render-mode.js';
import * as Sentry from '@sentry/node';
import { PlaywrightBrowserService } from '../common/index.js';
import { escapeHtml } from '../common/pdf/pdf-layout.js';
import type { WorkshopOrderForPdf } from './workshop-pdf.types.js';
import {
  buildWorkshopFooterTemplate,
  buildWorkshopHtmlDocument,
} from './workshop-pdf.layout.js';

@Injectable()
export class WorkshopPdfRenderer {
  private readonly logger = new Logger(WorkshopPdfRenderer.name);

  constructor(private readonly browserService: PlaywrightBrowserService) {}

  async render(
    order: WorkshopOrderForPdf,
    options: {
      documentLocale: DisplayLanguage;
      renderMode?: PdfRenderMode;
    },
  ): Promise<Buffer> {
    return Sentry.startSpan(
      { name: 'Render Workshop PDF', op: 'pdf.render' },
      async () => {
        const orderNumber = order.order_number ?? order.id;
        const browser = await this.browserService.getBrowser();
        const page = await browser.newPage();

        try {
          const html = this.generateHtml(
            order,
            orderNumber,
            options.documentLocale,
            options.renderMode ?? 'legacy',
          );
          await page.setContent(html, { timeout: 10_000 });

          const pdf = await Sentry.startSpan(
            { name: 'Render Page to PDF', op: 'pdf.browser.render' },
            () =>
              this.browserService.withTimeout(
                page.pdf({
                  format: 'A4',
                  margin: {
                    top: '50px',
                    right: '50px',
                    bottom: '70px',
                    left: '50px',
                  },
                  displayHeaderFooter: true,
                  headerTemplate: '<div></div>',
                  footerTemplate: this.buildFooterTemplate(
                    orderNumber,
                    options.documentLocale,
                    options.renderMode ?? 'legacy',
                  ),
                  printBackground: true,
                }),
                15_000,
                'Workshop PDF render timed out after 15 seconds',
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

  private generateHtml(
    order: WorkshopOrderForPdf,
    orderNumber: string,
    documentLocale: DisplayLanguage,
    renderMode: PdfRenderMode = 'legacy',
  ): string {
    return buildWorkshopHtmlDocument(
      order,
      orderNumber,
      escapeHtml,
      documentLocale,
      renderMode,
    );
  }

  private buildFooterTemplate(
    orderNumber: string,
    documentLocale: DisplayLanguage,
    renderMode: PdfRenderMode,
  ): string {
    return buildWorkshopFooterTemplate(
      orderNumber,
      escapeHtml,
      documentLocale,
      renderMode,
    );
  }
}
