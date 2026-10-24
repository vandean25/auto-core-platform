import type { DisplayLanguage } from '@prisma/client';
import type { PdfRenderMode } from '../common/i18n/pdf-render-mode.js';
import { buildAuthoritativeGermanLegalNoticeHtml } from '../common/i18n/pdf-legal-notice.js';
import {
  buildBasePdfStyles,
  buildPdfFooterTemplate,
  type EscapeHtml,
} from '../common/pdf/pdf-layout.js';
import {
  getWorkshopPdfCopy,
  type WorkshopPdfCopy,
} from './workshop-pdf-copy.js';
import type { WorkshopOrderForPdf } from './workshop-pdf.types.js';
import {
  buildWorkshopCheckInSection,
  buildWorkshopCheckInSectionStyles,
} from './workshop-pdf-check-in.layout.js';

export const buildWorkshopDocumentStyles = (): string => `
  ${buildBasePdfStyles()}
  ${buildWorkshopCheckInSectionStyles()}

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

export const buildWorkshopHeader = (
  safeOrderNumber: string,
  copy: WorkshopPdfCopy,
): string => `
  <div class="header">
    <div>
      <h1>${copy.jobCardTitle}</h1>
      <div style="color: #6b7280; margin-top: 4px;">${copy.orderLabel}: ${safeOrderNumber}</div>
    </div>
    <div>
      <span class="badge-jobcard">${copy.internalDocumentBadge}</span>
    </div>
  </div>
`;

export const buildWorkshopCustomerSection = (
  customer: WorkshopOrderForPdf['customer'],
  escape: EscapeHtml,
  copy: WorkshopPdfCopy,
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
      <div class="section-title">${copy.customerSectionTitle}</div>
      <div style="font-weight: 600;">${escape(safeCustomerName)}</div>
      ${cityLine ? `<div>${escape(cityLine)}</div>` : ''}
      ${customer?.phone ? `<div>${copy.phoneLabel}: ${escape(customer.phone)}</div>` : ''}
      ${customer?.email ? `<div>${copy.emailLabel}: ${escape(customer.email)}</div>` : ''}
    </div>
  `;
};

export const buildWorkshopVehicleSection = (
  vehicle: WorkshopOrderForPdf['vehicle'],
  odometer: number | null | undefined,
  fuelLevel: number | null | undefined,
  escape: EscapeHtml,
  copy: WorkshopPdfCopy,
): string => {
  const makeModelYear = `${escape(vehicle?.make) || '—'} ${escape(vehicle?.model) || '—'} (${escape(vehicle?.year) || '—'})`;
  const odometerDisplay = odometer != null ? `${escape(odometer)} km` : '—';
  const fuelDisplay = fuelLevel != null ? `${escape(fuelLevel)}%` : '—';

  return `
    <div class="section">
      <div class="section-title">${copy.vehicleSectionTitle}</div>
      <div style="font-weight: 600; font-size: 14px;">${makeModelYear}</div>
      ${vehicle?.vin ? `<div>${copy.vinLabel}: <span style="font-family: monospace;">${escape(vehicle.vin)}</span></div>` : ''}
      ${vehicle?.plate ? `<div>${copy.plateLabel}: <strong>${escape(vehicle.plate)}</strong></div>` : ''}
      
      <div class="vehicle-stats">
        <div class="stat-box">
          <div class="stat-label">${copy.odometerLabel}</div>
          <div class="stat-value">${odometerDisplay}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">${copy.fuelLevelLabel}</div>
          <div class="stat-value">${fuelDisplay}</div>
        </div>
      </div>
    </div>
  `;
};

export const buildWorkshopReportedIssueSection = (
  reportedIssue: string | null | undefined,
  escape: EscapeHtml,
  copy: WorkshopPdfCopy,
): string => {
  if (!reportedIssue) {
    return '';
  }

  return `
    <div class="issue-box">
      <div class="issue-title">${copy.reportedIssueTitle}</div>
      <div style="white-space: pre-wrap;">${escape(reportedIssue)}</div>
    </div>
  `;
};

export const buildWorkshopTasksSection = (
  tasks: WorkshopOrderForPdf['tasks'],
  escape: EscapeHtml,
  copy: WorkshopPdfCopy,
): string => {
  if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
    return `
      <div class="section">
        <div class="section-title" style="font-size: 14px;">${copy.tasksSectionTitle}</div>
        <div style="color: #6b7280; padding: 12px; background: #f9fafb; border-radius: 6px; text-align: center;">${copy.noTasksMessage}</div>
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
                <th style="width: 50px;">${copy.lineItemTypeHeader}</th>
                <th style="width: 80px;">${copy.lineItemNoHeader}</th>
                <th>${copy.lineItemDescriptionHeader}</th>
                <th style="text-align: right; width: 60px;">${copy.lineItemQtyHeader}</th>
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
                  <strong>${copy.mechanicNotesLabel}:</strong><br/>
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
      <div class="section-title" style="font-size: 14px;">${copy.tasksSectionTitle}</div>
      ${tasksHtml}
    </div>
  `;
};

export const buildWorkshopInternalNotesSection = (
  notes: string | null | undefined,
  escape: EscapeHtml,
  copy: WorkshopPdfCopy,
): string => {
  if (!notes) {
    return '';
  }

  return `
    <div class="section">
      <div class="section-title">${copy.internalNotesTitle}</div>
      <div style="white-space: pre-wrap;">${escape(notes)}</div>
    </div>
  `;
};

export const buildWorkshopFooterNotes = (copy: WorkshopPdfCopy): string => `
  <div class="footer-notes">
    ${copy.footerSignatureLine}
  </div>
`;

export const buildWorkshopFooterTemplate = (
  orderNumber: string,
  escape: EscapeHtml,
  documentLocale: DisplayLanguage,
  renderMode: PdfRenderMode = 'legacy',
): string => {
  const copy = getWorkshopPdfCopy(documentLocale, renderMode);
  return buildPdfFooterTemplate(
    escape(copy.footerDocumentLabel(orderNumber)),
    documentLocale,
  );
};

export const buildWorkshopHtmlDocument = (
  order: WorkshopOrderForPdf,
  orderNumber: string,
  escape: EscapeHtml,
  documentLocale: DisplayLanguage,
  renderMode: PdfRenderMode = 'legacy',
): string => {
  const safeOrderNumber = escape(orderNumber);
  const copy = getWorkshopPdfCopy(documentLocale, renderMode);
  const legalNotice =
    renderMode === 'localized'
      ? buildAuthoritativeGermanLegalNoticeHtml(documentLocale, escape)
      : '';

  return `
    <!DOCTYPE html>
    <html lang="${copy.htmlLang}">
    <head>
      <style>
        ${buildWorkshopDocumentStyles()}
      </style>
    </head>
    <body>
      ${buildWorkshopHeader(safeOrderNumber, copy)}

      <div class="info-grid">
        ${buildWorkshopCustomerSection(order.customer, escape, copy)}
        ${buildWorkshopVehicleSection(order.vehicle, order.odometer, order.fuel_level, escape, copy)}
      </div>

      ${buildWorkshopReportedIssueSection(order.reported_issue, escape, copy)}
      ${buildWorkshopTasksSection(order.tasks, escape, copy)}
      ${
        order.check_in
          ? buildWorkshopCheckInSection(
              order.check_in.snapshot,
              order.check_in.embedded,
              escape,
              documentLocale,
              renderMode,
            )
          : ''
      }
      ${buildWorkshopInternalNotesSection(order.notes, escape, copy)}
      ${legalNotice}${buildWorkshopFooterNotes(copy)}
    </body>
    </html>
  `;
};
