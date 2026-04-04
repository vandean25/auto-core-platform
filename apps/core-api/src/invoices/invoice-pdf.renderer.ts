import { Injectable } from '@nestjs/common';
import { chromium } from 'playwright';
import * as Sentry from '@sentry/node';
import type { InvoiceSnapshot } from './invoice-snapshot';

@Injectable()
export class InvoicePdfRenderer {
  async render(snapshot: InvoiceSnapshot): Promise<Buffer> {
    return Sentry.startSpan(
      { name: 'Render PDF', op: 'pdf.render' },
      async () => {
        const invoiceNumber = snapshot.invoice_number ?? snapshot.id;
        const browser = await Sentry.startSpan(
          { name: 'Launch Browser', op: 'pdf.browser.launch' },
          () => chromium.launch(),
        );

        try {
          const page = await browser.newPage();
          const html = this.generateHtml(snapshot);
          await page.setContent(html);

          const pdf = await Sentry.startSpan(
            { name: 'Render Page to PDF', op: 'pdf.browser.render' },
            () =>
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
          );

          return Buffer.from(pdf);
        } finally {
          await browser.close().catch((err) => {
            // Log but don't rethrow cleanup errors to avoid masking the original failure
            console.error(
              'Failed to close browser during PDF render cleanup:',
              err,
            );
          });
        }
      },
    );
  }

  private generateHtml(snapshot: InvoiceSnapshot): string {
    const invoiceNumber = snapshot.invoice_number ?? snapshot.id;
    const itemsHtml = snapshot.items
      .map(
        (item) => `
      <tr>
        <td>${item.description}</td>
        <td style="text-align: right">${item.quantity}</td>
        <td style="text-align: right">${item.unit_price}</td>
        <td style="text-align: right">${item.line_total ?? ''}</td>
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

          .notes { break-inside: avoid; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Invoice</h1>
          <div class="muted">${invoiceNumber}</div>
        </div>

        <div style="display: flex; justify-content: space-between;">
          <div class="section">
            <div class="section-title">Bill to:</div>
            <div>${customerName}</div>
            <div>${snapshot.customer.address_street ?? ''}</div>
            <div>${cityLine}</div>
            ${snapshot.customer.address_country ? `<div>${snapshot.customer.address_country}</div>` : ''}
            ${snapshot.customer.vat_id ? `<div>VAT ID: ${snapshot.customer.vat_id}</div>` : ''}
          </div>

          <div class="section" style="text-align: right">
            <div><strong>Invoice Number:</strong> ${invoiceNumber}</div>
            <div><strong>Date:</strong> ${this.formatDate(snapshot.date)}</div>
            <div><strong>Due Date:</strong> ${this.formatDate(snapshot.due_date)}</div>
          </div>
        </div>

        ${
          snapshot.vehicle
            ? `
          <div class="section">
            <div class="section-title">Vehicle:</div>
            <div>${snapshot.vehicle.make} ${snapshot.vehicle.model} (${snapshot.vehicle.year})</div>
            ${snapshot.vehicle.plate ? `<div>Plate: ${snapshot.vehicle.plate}</div>` : ''}
            ${snapshot.vehicle.vin ? `<div>VIN: ${snapshot.vehicle.vin}</div>` : ''}
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
            <span>${snapshot.total_net}</span>
          </div>
          <div class="total-row">
            <span>Tax:</span>
            <span>${snapshot.total_tax}</span>
          </div>
          <div class="total-row grand">
            <span>Gross:</span>
            <span>${snapshot.total_gross}</span>
          </div>
        </div>

        ${
          snapshot.notes
            ? `
          <div class="section notes" style="margin-top: 26px;">
            <div class="section-title">Notes</div>
            <div>${snapshot.notes}</div>
          </div>
        `
            : ''
        }
      </body>
      </html>
    `;
  }

  private buildFooterTemplate(invoiceNumber: string): string {
    return `
      <div style="
        width: 100%;
        padding: 0 50px;
        font-size: 9px;
        color: #6b7280;
        display: flex;
        justify-content: space-between;
        align-items: center;
      ">
        <span>Invoice ${invoiceNumber}</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>
    `;
  }

  private formatDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toISOString().slice(0, 10);
  }
}
