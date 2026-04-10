import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { PlaywrightBrowserService } from '../common';
import type { InvoiceSnapshot } from './invoice-snapshot';

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
          const html = this.generateHtml(snapshot, invoiceNumber);
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
                  footerTemplate: this.buildFooterTemplate(invoiceNumber),
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

  private generateHtml(
    snapshot: InvoiceSnapshot,
    invoiceNumber: string,
  ): string {
    const safeInvoiceNumber = this.escapeHtml(invoiceNumber);
    const itemsHtml = snapshot.items
      .map(
        (item) => `
      <tr>
        <td>${this.escapeHtml(item.description)}</td>
        <td style="text-align: right">${this.escapeHtml(item.quantity)}</td>
        <td style="text-align: right">${this.escapeHtml(item.unit_price)}</td>
        <td style="text-align: right">${this.escapeHtml(item.line_total ?? '')}</td>
      </tr>
    `,
      )
      .join('');

    const customerName =
      snapshot.customer.type === 'COMPANY'
        ? (snapshot.customer.company_name ??
          `${snapshot.customer.first_name} ${snapshot.customer.last_name}`)
        : `${snapshot.customer.first_name} ${snapshot.customer.last_name}`;

    const cityLine = [
      snapshot.customer.address_zip,
      snapshot.customer.address_city,
    ]
      .filter(Boolean)
      .join(' ');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          * { box-sizing: border-box; }
          body {
            margin: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
            font-size: 12px;
            color: #111827;
            line-height: 1.45;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          h1 { font-size: 22px; margin: 0; letter-spacing: 0.2px; }

          .header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 24px; }
          .header .muted { color: #6b7280; font-size: 12px; }

          .section { margin-bottom: 18px; }
          .section-title {
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.6px;
            color: #374151;
            border-bottom: 1px solid #e5e7eb;
            padding-bottom: 6px;
            margin-bottom: 10px;
          }

          table { width: 100%; border-collapse: collapse; margin: 18px 0; table-layout: fixed; }
          thead { display: table-header-group; }
          tr { break-inside: avoid; }
          th {
            text-align: left;
            border-bottom: 1px solid #d1d5db;
            padding: 10px 8px;
            font-size: 11px;
            font-weight: 700;
            color: #374151;
            background: #f9fafb;
          }
          td { padding: 10px 8px; border-bottom: 1px solid #f3f4f6; vertical-align: top; word-break: break-word; }

          .totals { margin-left: auto; width: 260px; break-inside: avoid; }
          .total-row { display: flex; justify-content: space-between; padding: 4px 0; }
          .total-row.grand { font-weight: 800; font-size: 13px; border-top: 1px solid #d1d5db; margin-top: 8px; padding-top: 10px; }

          .notes-container { break-inside: avoid; white-space: pre-wrap; margin-top: 26px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Invoice</h1>
          <div class="muted">${safeInvoiceNumber}</div>
        </div>

        <div style="display: flex; justify-content: space-between;">
          <div class="section">
            <div class="section-title">Bill to:</div>
            <div style="font-weight: 600;">${this.escapeHtml(customerName)}</div>
            ${snapshot.customer.address_street ? `<div>${this.escapeHtml(snapshot.customer.address_street)}</div>` : ''}
            ${cityLine ? `<div>${this.escapeHtml(cityLine)}</div>` : ''}
            ${snapshot.customer.address_country ? `<div>${this.escapeHtml(snapshot.customer.address_country)}</div>` : ''}
            ${snapshot.customer.vat_id ? `<div>VAT ID: ${this.escapeHtml(snapshot.customer.vat_id)}</div>` : ''}
          </div>

          <div class="section" style="text-align: right">
            <div><strong>Invoice Number:</strong> ${safeInvoiceNumber}</div>
            <div><strong>Date:</strong> ${this.escapeHtml(this.formatDate(snapshot.date))}</div>
            <div><strong>Due Date:</strong> ${this.escapeHtml(this.formatDate(snapshot.due_date))}</div>
          </div>
        </div>

        ${
          snapshot.vehicle
            ? `
          <div class="section">
            <div class="section-title">Vehicle:</div>
            <div style="font-weight: 600;">${this.escapeHtml(snapshot.vehicle.make)} ${this.escapeHtml(snapshot.vehicle.model)} (${this.escapeHtml(snapshot.vehicle.year)})</div>
            ${snapshot.vehicle.plate ? `<div>Plate: <strong>${this.escapeHtml(snapshot.vehicle.plate)}</strong></div>` : ''}
            ${snapshot.vehicle.vin ? `<div>VIN: <span style="font-family: monospace;">${this.escapeHtml(snapshot.vehicle.vin)}</span></div>` : ''}
          </div>
        `
            : ''
        }

        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th style="text-align: right; width: 80px;">Qty</th>
              <th style="text-align: right; width: 100px;">Unit Price</th>
              <th style="text-align: right; width: 100px;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        <div class="totals">
          <div class="total-row">
            <span>Net:</span>
            <span>${this.escapeHtml(snapshot.total_net)}</span>
          </div>
          <div class="total-row">
            <span>Tax:</span>
            <span>${this.escapeHtml(snapshot.total_tax)}</span>
          </div>
          <div class="total-row grand">
            <span>Gross:</span>
            <span>${this.escapeHtml(snapshot.total_gross)}</span>
          </div>
        </div>

        ${
          snapshot.notes
            ? `
          <div class="section notes-container">
            <div class="section-title">Notes</div>
            <div>${this.escapeHtml(snapshot.notes)}</div>
          </div>
        `
            : ''
        }
      </body>
      </html>
    `;
  }

  private buildFooterTemplate(invoiceNumber: string): string {
    const safeInvoiceNumber = this.escapeHtml(invoiceNumber);
    return `
      <div style="
        width: 100%;
        padding: 0 50px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
        font-size: 9px;
        color: #6b7280;
        display: flex;
        justify-content: space-between;
        align-items: center;
      ">
        <span>Invoice ${safeInvoiceNumber}</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>
    `;
  }

  private escapeHtml(value: string | number | null | undefined): string {
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

  private formatDate(value: string | Date) {
    const date = typeof value === 'string' ? new Date(value) : value;
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    return date.toISOString().slice(0, 10);
  }
}
