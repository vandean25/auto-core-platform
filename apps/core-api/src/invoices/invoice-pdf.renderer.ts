import { Injectable } from '@nestjs/common';
import { chromium } from 'playwright';
import type { InvoiceSnapshot } from './invoice-snapshot';

@Injectable()
export class InvoicePdfRenderer {
  async render(snapshot: InvoiceSnapshot): Promise<Buffer> {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const html = this.generateHtml(snapshot);
      await page.setContent(html);

      const pdf = await page.pdf({
        format: 'A4',
        margin: { top: '50px', right: '50px', bottom: '50px', left: '50px' },
        printBackground: true,
      });

      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
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
        ? snapshot.customer.company_name ??
          `${snapshot.customer.first_name} ${snapshot.customer.last_name}`
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
          body { font-family: sans-serif; color: #333; line-height: 1.4; }
          .header { text-align: center; margin-bottom: 30px; }
          .section { margin-bottom: 20px; }
          .section-title { font-weight: bold; border-bottom: 1px solid #ccc; margin-bottom: 10px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          th { text-align: left; border-bottom: 2px solid #333; padding: 8px; }
          td { padding: 8px; border-bottom: 1px solid #eee; }
          .totals { margin-left: auto; width: 250px; }
          .total-row { display: flex; justify-content: space-between; padding: 4px 0; }
          .total-row.grand { font-weight: bold; font-size: 1.2em; border-top: 2px solid #333; margin-top: 8px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Invoice</h1>
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
          <div class="section" style="margin-top: 30px;">
            <div class="section-title">Notes:</div>
            <div>${snapshot.notes}</div>
          </div>
        `
            : ''
        }
      </body>
      </html>
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
