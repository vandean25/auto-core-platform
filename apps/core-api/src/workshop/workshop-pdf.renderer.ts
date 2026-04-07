import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { PlaywrightBrowserService } from '../common';
import type { WorkshopOrderForPdf } from './workshop-pdf.types';

@Injectable()
export class WorkshopPdfRenderer {
  private readonly logger = new Logger(WorkshopPdfRenderer.name);

  constructor(
    private readonly browserService: PlaywrightBrowserService,
  ) {}

  async render(order: WorkshopOrderForPdf): Promise<Buffer> {
    return Sentry.startSpan(
      { name: 'Render Workshop PDF', op: 'pdf.render' },
      async () => {
        const orderNumber = order.order_number ?? order.id;
        const browser = await this.browserService.getBrowser();
        const page = await browser.newPage();

        try {
          const html = this.generateHtml(order, orderNumber);
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
                  footerTemplate: this.buildFooterTemplate(orderNumber),
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
  ): string {
    const safeOrderNumber = this.escapeHtml(orderNumber);

    const personName = [
      order.customer?.first_name,
      order.customer?.last_name,
    ]
      .filter(Boolean)
      .join(' ')
      .trim();
    const customerName =
      order.customer?.type === 'COMPANY'
        ? (order.customer.company_name ?? personName)
        : personName;
    const safeCustomerName = customerName.trim() || '—';

    const cityLine = [order.customer?.address_zip, order.customer?.address_city]
      .filter(Boolean)
      .join(' ');

    let tasksHtml = '';
    if (order.tasks && Array.isArray(order.tasks)) {
      tasksHtml = order.tasks
        .map((task) => {
          let lineItemsHtml = '';
          if (
            task.line_items &&
            Array.isArray(task.line_items) &&
            task.line_items.length > 0
          ) {
            lineItemsHtml = `
              <table class="line-items">
                <thead>
                  <tr>
                    <th style="width: 50px;">Type</th>
                    <th style="width: 80px;">Item No</th>
                    <th>Description</th>
                    <th style="text-align: right; width: 60px;">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  ${task.line_items
                    .map(
                      (line) => `
                    <tr>
                      <td><span class="badge">${this.escapeHtml(line.type) || '—'}</span></td>
                      <td>${this.escapeHtml(line.item_no) || '—'}</td>
                      <td>${this.escapeHtml(line.description) || '—'}</td>
                      <td style="text-align: right">${line.quantity != null ? this.escapeHtml(line.quantity) : '—'}</td>
                    </tr>
                  `,
                    )
                    .join('')}
                </tbody>
              </table>
            `;
          }

          return `
          <div class="task-card">
            <div class="task-header">
              <div class="task-title">${this.escapeHtml(task.title)}</div>
            </div>
            ${
              task.mechanic_notes
                ? `<div class="task-notes">
                    <strong>Mechanic Notes:</strong><br/>
                    ${this.escapeHtml(task.mechanic_notes)}
                  </div>`
                : ''
            }
            ${lineItemsHtml}
          </div>
        `;
        })
        .join('');
    }

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

          h1 { font-size: 24px; margin: 0; letter-spacing: 0.2px; }

          .header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 24px; border-bottom: 2px solid #e5e7eb; padding-bottom: 16px; }
          .badge-jobcard { background: #1e40af; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }

          .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }
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

          .vehicle-stats { display: flex; gap: 16px; margin-top: 8px; }
          .stat-box { background: #f3f4f6; padding: 8px 12px; border-radius: 6px; flex: 1; }
          .stat-label { font-size: 10px; color: #6b7280; text-transform: uppercase; }
          .stat-value { font-size: 14px; font-weight: 600; margin-top: 2px; }

          .task-card { border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 16px; padding: 16px; page-break-inside: avoid; }
          .task-header { display: flex; justify-content: space-between; margin-bottom: 12px; }
          .task-title { font-size: 14px; font-weight: 600; }
          .task-notes { background: #fffbeb; color: #92400e; padding: 10px; border-radius: 6px; margin-bottom: 12px; border-left: 4px solid #f59e0b; }

          table.line-items { width: 100%; border-collapse: collapse; margin-top: 8px; }
          table.line-items th { text-align: left; border-bottom: 1px solid #d1d5db; padding: 6px 8px; font-size: 10px; color: #6b7280; text-transform: uppercase; }
          table.line-items td { padding: 8px; border-bottom: 1px solid #f3f4f6; font-size: 11px; }
          
          .badge { background: #e5e7eb; color: #374151; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 600; }

          .issue-box { background: #fee2e2; border: 1px solid #fca5a5; padding: 16px; border-radius: 8px; margin-bottom: 24px; color: #991b1b; }
          .issue-title { font-weight: 700; margin-bottom: 4px; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; }

          .footer-notes { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #6b7280; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h1>Job Card</h1>
            <div style="color: #6b7280; margin-top: 4px;">Order: ${safeOrderNumber}</div>
          </div>
          <div>
            <span class="badge-jobcard">Internal Document</span>
          </div>
        </div>

        <div class="info-grid">
          <div class="section">
            <div class="section-title">Customer</div>
            <div style="font-weight: 600;">${this.escapeHtml(safeCustomerName)}</div>
            ${cityLine ? `<div>${this.escapeHtml(cityLine)}</div>` : ''}
            ${order.customer?.phone ? `<div>Phone: ${this.escapeHtml(order.customer.phone)}</div>` : ''}
            ${order.customer?.email ? `<div>Email: ${this.escapeHtml(order.customer.email)}</div>` : ''}
          </div>

          <div class="section">
            <div class="section-title">Vehicle Details</div>
            <div style="font-weight: 600; font-size: 14px;">${this.escapeHtml(order.vehicle?.make) || '—'} ${this.escapeHtml(order.vehicle?.model) || '—'} (${this.escapeHtml(order.vehicle?.year) || '—'})</div>
            ${order.vehicle?.vin ? `<div>VIN: <span style="font-family: monospace;">${this.escapeHtml(order.vehicle.vin)}</span></div>` : ''}
            ${order.vehicle?.plate ? `<div>Plate: <strong>${this.escapeHtml(order.vehicle.plate)}</strong></div>` : ''}
            
            <div class="vehicle-stats">
              <div class="stat-box">
                <div class="stat-label">Odometer</div>
                <div class="stat-value">${order.odometer != null ? this.escapeHtml(order.odometer) + ' km' : '—'}</div>
              </div>
              <div class="stat-box">
                <div class="stat-label">Fuel Level</div>
                <div class="stat-value">${order.fuel_level != null ? this.escapeHtml(order.fuel_level) + '%' : '—'}</div>
              </div>
            </div>
          </div>
        </div>

        ${
          order.reported_issue
            ? `
          <div class="issue-box">
            <div class="issue-title">Reported Issue / Customer Complaint</div>
            <div style="white-space: pre-wrap;">${this.escapeHtml(order.reported_issue)}</div>
          </div>
        `
            : ''
        }

        <div class="section">
          <div class="section-title" style="font-size: 14px;">Tasks & Operations</div>
          ${tasksHtml || '<div style="color: #6b7280; padding: 12px; background: #f9fafb; border-radius: 6px; text-align: center;">No tasks assigned yet.</div>'}
        </div>

        ${
          order.notes
            ? `
          <div class="section">
            <div class="section-title">Internal Notes</div>
            <div style="white-space: pre-wrap;">${this.escapeHtml(order.notes)}</div>
          </div>
        `
            : ''
        }
        
        <div class="footer-notes">
          Signature Mechanic: ___________________________ &nbsp;&nbsp;&nbsp;&nbsp; Date: ________________
        </div>
      </body>
      </html>
    `;
  }

  private buildFooterTemplate(orderNumber: string): string {
    const safeOrderNumber = this.escapeHtml(orderNumber);
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
        <span>Job Card ${safeOrderNumber}</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>
    `;
  }

  private escapeHtml(value: unknown): string {
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
}
