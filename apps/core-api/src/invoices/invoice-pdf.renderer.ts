import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { PlaywrightBrowserService } from '../common';
import type { InvoiceSnapshot } from './invoice-snapshot';
import {
  buildInvoiceFooterTemplate,
  buildInvoiceHtmlDocument,
  type EscapeHtml,
  type FormatDate,
} from './invoice-pdf.layout';

@Injectable()
export class InvoicePdfRenderer {
  private readonly logger = new Logger(InvoicePdfRenderer.name);

  constructor(private readonly browserService: PlaywrightBrowserService) {}

  async render(snapshot: InvoiceSnapshot): Promise<Buffer> {
    return Sentry.startSpan(
      { name: 'Render PDF', op: 'pdf.render' },
      async () => {
        const invoiceNumber = snapshot.invoice_number ?? snapshot.id;
        const browser = await this.browserService.getBrowser();
        const page = await browser.newPage();

        try {
          const escapeHtml: EscapeHtml = (value) => this.escapeHtmlValue(value);
          const formatDate: FormatDate = (value) => this.formatDateValue(value);
          const html = buildInvoiceHtmlDocument(
            snapshot,
            invoiceNumber,
            escapeHtml,
            formatDate,
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
                  footerTemplate: buildInvoiceFooterTemplate(
                    invoiceNumber,
                    escapeHtml,
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

  private escapeHtmlValue(value: string | number | null | undefined): string {
    if (value === null || value === undefined) {
      return '';
    }
    const str = String(value);
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private formatDateValue(value: string | Date) {
    const date = typeof value === 'string' ? new Date(value) : value;
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    return date.toISOString().slice(0, 10);
  }
}
