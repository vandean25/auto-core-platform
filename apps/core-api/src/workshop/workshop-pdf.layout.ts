import {
  buildBasePdfStyles,
  buildPdfFooterTemplate,
  type EscapeHtml,
} from '../common/pdf/pdf-layout';
import type { WorkshopOrderForPdf } from './workshop-pdf.types';

export const buildWorkshopDocumentStyles = (): string => `
  ${buildBasePdfStyles()}

  h1 { font-size: 24px; margin: 0; letter-spacing: 0.2px; }

  .header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 24px; border-bottom: 2px solid #e5e7eb; padding-bottom: 16px; }
  .badge-jobcard { background: #1e40af; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }

  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }

  .vehicle-stats { display: flex; gap: 16px; margin-top: 8px; }
  .stat-box { background: #f3f4f6; padding: 8px 12px; border-radius: 6px; flex: 1; }
  .stat-label { font-size: 10px; color: #6b7280; text-transform: uppercase; }
  .stat-value { font-size: 14px; font-weight: 600; margin-top: 2px; }

  .task-card { border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 16px; padding: 16px; page-break-inside: avoid; }
  .task-header { display: flex; justify-content: space-between; margin-bottom: 12px; }
  .task-title { font-size: 14px; font-weight: 600; }
  .task-notes { background: #fffbeb; color: #92400e; padding: 10px; border-radius: 6px; margin-bottom: 12px; border-left: 4px solid #f59e0b; }

  table.line-items { margin-top: 8px; }
  table.line-items th { padding: 6px 8px; font-size: 10px; color: #6b7280; text-transform: uppercase; }
  table.line-items td { padding: 8px; font-size: 11px; }
  
  .badge { background: #e5e7eb; color: #374151; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 600; }

  .issue-box { background: #fee2e2; border: 1px solid #fca5a5; padding: 16px; border-radius: 8px; margin-bottom: 24px; color: #991b1b; }
  .issue-title { font-weight: 700; margin-bottom: 4px; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; }

  .footer-notes { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #6b7280; }
`;

export const buildWorkshopHeader = (safeOrderNumber: string): string => `
  <div class="header">
    <div>
      <h1>Job Card</h1>
      <div style="color: #6b7280; margin-top: 4px;">Order: ${safeOrderNumber}</div>
    </div>
    <div>
      <span class="badge-jobcard">Internal Document</span>
    </div>
  </div>
`;

export const buildWorkshopCustomerSection = (
  customer: WorkshopOrderForPdf['customer'],
  escape: EscapeHtml,
): string => {
  const personName = [customer?.first_name, customer?.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  const customerName =
    customer?.type === 'COMPANY'
      ? (customer.company_name ?? personName)
      : personName;
  const safeCustomerName = customerName.trim() || '—';

  const cityLine = [customer?.address_zip, customer?.address_city]
    .filter(Boolean)
    .join(' ');

  return `
    <div class="section">
      <div class="section-title">Customer</div>
      <div style="font-weight: 600;">${escape(safeCustomerName)}</div>
      ${cityLine ? `<div>${escape(cityLine)}</div>` : ''}
      ${customer?.phone ? `<div>Phone: ${escape(customer.phone)}</div>` : ''}
      ${customer?.email ? `<div>Email: ${escape(customer.email)}</div>` : ''}
    </div>
  `;
};

export const buildWorkshopVehicleSection = (
  vehicle: WorkshopOrderForPdf['vehicle'],
  odometer: number | null | undefined,
  fuelLevel: number | null | undefined,
  escape: EscapeHtml,
): string => {
  const makeModelYear = `${escape(vehicle?.make) || '—'} ${escape(vehicle?.model) || '—'} (${escape(vehicle?.year) || '—'})`;
  const odometerDisplay = odometer != null ? `${escape(odometer)} km` : '—';
  const fuelDisplay = fuelLevel != null ? `${escape(fuelLevel)}%` : '—';

  return `
    <div class="section">
      <div class="section-title">Vehicle Details</div>
      <div style="font-weight: 600; font-size: 14px;">${makeModelYear}</div>
      ${vehicle?.vin ? `<div>VIN: <span style="font-family: monospace;">${escape(vehicle.vin)}</span></div>` : ''}
      ${vehicle?.plate ? `<div>Plate: <strong>${escape(vehicle.plate)}</strong></div>` : ''}
      
      <div class="vehicle-stats">
        <div class="stat-box">
          <div class="stat-label">Odometer</div>
          <div class="stat-value">${odometerDisplay}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Fuel Level</div>
          <div class="stat-value">${fuelDisplay}</div>
        </div>
      </div>
    </div>
  `;
};

export const buildWorkshopReportedIssueSection = (
  reportedIssue: string | null | undefined,
  escape: EscapeHtml,
): string => {
  if (!reportedIssue) {
    return '';
  }

  return `
    <div class="issue-box">
      <div class="issue-title">Reported Issue / Customer Complaint</div>
      <div style="white-space: pre-wrap;">${escape(reportedIssue)}</div>
    </div>
  `;
};

export const buildWorkshopTasksSection = (
  tasks: WorkshopOrderForPdf['tasks'],
  escape: EscapeHtml,
): string => {
  if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
    return `
      <div class="section">
        <div class="section-title" style="font-size: 14px;">Tasks & Operations</div>
        <div style="color: #6b7280; padding: 12px; background: #f9fafb; border-radius: 6px; text-align: center;">No tasks assigned yet.</div>
      </div>
    `;
  }

  const tasksHtml = tasks
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
                  <td><span class="badge">${escape(line.type) || '—'}</span></td>
                  <td>${escape(line.item_no) || '—'}</td>
                  <td>${escape(line.description) || '—'}</td>
                  <td style="text-align: right">${line.quantity != null ? escape(line.quantity) : '—'}</td>
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
            <div class="task-title">${escape(task.title)}</div>
          </div>
          ${
            task.mechanic_notes
              ? `<div class="task-notes">
                  <strong>Mechanic Notes:</strong><br/>
                  ${escape(task.mechanic_notes)}
                </div>`
              : ''
          }
          ${lineItemsHtml}
        </div>
      `;
    })
    .join('');

  return `
    <div class="section">
      <div class="section-title" style="font-size: 14px;">Tasks & Operations</div>
      ${tasksHtml}
    </div>
  `;
};

export const buildWorkshopInternalNotesSection = (
  notes: string | null | undefined,
  escape: EscapeHtml,
): string => {
  if (!notes) {
    return '';
  }

  return `
    <div class="section">
      <div class="section-title">Internal Notes</div>
      <div style="white-space: pre-wrap;">${escape(notes)}</div>
    </div>
  `;
};

export const buildWorkshopFooterNotes = (): string => `
  <div class="footer-notes">
    Signature Mechanic: ___________________________ &nbsp;&nbsp;&nbsp;&nbsp; Date: ________________
  </div>
`;

export const buildWorkshopFooterTemplate = (
  orderNumber: string,
  escape: EscapeHtml,
): string => buildPdfFooterTemplate(`Job Card ${escape(orderNumber)}`);

export const buildWorkshopHtmlDocument = (
  order: WorkshopOrderForPdf,
  orderNumber: string,
  escape: EscapeHtml,
): string => {
  const safeOrderNumber = escape(orderNumber);

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        ${buildWorkshopDocumentStyles()}
      </style>
    </head>
    <body>
      ${buildWorkshopHeader(safeOrderNumber)}

      <div class="info-grid">
        ${buildWorkshopCustomerSection(order.customer, escape)}
        ${buildWorkshopVehicleSection(order.vehicle, order.odometer, order.fuel_level, escape)}
      </div>

      ${buildWorkshopReportedIssueSection(order.reported_issue, escape)}
      ${buildWorkshopTasksSection(order.tasks, escape)}
      ${buildWorkshopInternalNotesSection(order.notes, escape)}
      ${buildWorkshopFooterNotes()}
    </body>
    </html>
  `;
};
