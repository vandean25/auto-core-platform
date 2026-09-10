import {
  buildBasePdfStyles,
  buildPdfFooterTemplate,
  type EscapeHtml,
} from '../common/pdf/pdf-layout';
import type { InvoiceSnapshot } from './invoice-snapshot';

export type { EscapeHtml };
export type FormatDate = (value: string | Date) => string;

export const buildInvoiceDocumentStyles = (): string => `
  ${buildBasePdfStyles()}

  h1 { font-size: 22px; margin: 0; letter-spacing: 0.2px; }

  .header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 24px; }
  .header .muted { color: #6b7280; font-size: 12px; }

  table { margin: 18px 0; table-layout: fixed; }
  th {
    padding: 10px 8px;
    font-size: 11px;
    font-weight: 700;
    color: #374151;
    background: #f9fafb;
  }
  td { padding: 10px 8px; vertical-align: top; word-break: break-word; }

  .totals { margin-left: auto; width: 260px; break-inside: avoid; }
  .total-row { display: flex; justify-content: space-between; padding: 4px 0; }
  .total-row.grand { font-weight: 800; font-size: 13px; border-top: 1px solid #d1d5db; margin-top: 8px; padding-top: 10px; }

  .notes-container { break-inside: avoid; white-space: pre-wrap; margin-top: 26px; }
  .legal-line { margin-top: 24px; font-size: 10px; color: #374151; }
`;

export const buildInvoiceHeader = (
  invoiceNumber: string,
  escapeHtml: EscapeHtml,
): string => `
  <div class="header">
    <h1>Invoice</h1>
    <div class="muted">${escapeHtml(invoiceNumber)}</div>
  </div>
`;

const buildCustomerName = (snapshot: InvoiceSnapshot): string =>
  snapshot.customer.type === 'COMPANY'
    ? (snapshot.customer.company_name ??
      `${snapshot.customer.first_name} ${snapshot.customer.last_name}`)
    : `${snapshot.customer.first_name} ${snapshot.customer.last_name}`;

export const buildInvoiceCustomerSection = (
  snapshot: InvoiceSnapshot,
  escapeHtml: EscapeHtml,
): string => {
  const customerName = buildCustomerName(snapshot);
  const cityLine = [
    snapshot.customer.address_zip,
    snapshot.customer.address_city,
  ]
    .filter(Boolean)
    .join(' ');

  return `
    <div class="section">
      <div class="section-title">Bill to:</div>
      <div style="font-weight: 600;">${escapeHtml(customerName)}</div>
      ${snapshot.customer.address_street ? `<div>${escapeHtml(snapshot.customer.address_street)}</div>` : ''}
      ${cityLine ? `<div>${escapeHtml(cityLine)}</div>` : ''}
      ${snapshot.customer.address_country ? `<div>${escapeHtml(snapshot.customer.address_country)}</div>` : ''}
      ${snapshot.customer.vat_id ? `<div>VAT ID: ${escapeHtml(snapshot.customer.vat_id)}</div>` : ''}
    </div>
  `;
};

export const buildInvoiceMetaSection = (
  snapshot: InvoiceSnapshot,
  invoiceNumber: string,
  escapeHtml: EscapeHtml,
  formatDate: FormatDate,
): string => `
  <div class="section" style="text-align: right">
    <div><strong>Invoice Number:</strong> ${escapeHtml(invoiceNumber)}</div>
    <div><strong>Date:</strong> ${escapeHtml(formatDate(snapshot.date))}</div>
    <div><strong>Due Date:</strong> ${escapeHtml(formatDate(snapshot.due_date))}</div>
  </div>
`;

export const buildInvoiceVehicleSection = (
  snapshot: InvoiceSnapshot,
  escapeHtml: EscapeHtml,
): string => {
  if (!snapshot.vehicle) {
    return '';
  }

  const vehicle = snapshot.vehicle;

  return `
    <div class="section">
      <div class="section-title">Vehicle:</div>
      <div style="font-weight: 600;">${escapeHtml(vehicle.make)} ${escapeHtml(vehicle.model)} (${escapeHtml(vehicle.year)})</div>
      ${vehicle.plate ? `<div>Plate: <strong>${escapeHtml(vehicle.plate)}</strong></div>` : ''}
      ${vehicle.vin ? `<div>VIN: <span style="font-family: monospace;">${escapeHtml(vehicle.vin)}</span></div>` : ''}
    </div>
  `;
};

export const buildInvoiceItemsTable = (
  snapshot: InvoiceSnapshot,
  escapeHtml: EscapeHtml,
): string => {
  const itemsHtml = snapshot.items
    .map(
      (item) => `
      <tr>
        <td>${escapeHtml(item.description)}</td>
        <td style="text-align: right">${escapeHtml(item.quantity)}</td>
        <td style="text-align: right">${escapeHtml(item.unit_price)}</td>
        <td style="text-align: right">${escapeHtml(item.line_total ?? '')}</td>
      </tr>
    `,
    )
    .join('');

  return `
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
  `;
};

export const buildInvoiceTotalsSection = (
  snapshot: InvoiceSnapshot,
  escapeHtml: EscapeHtml,
): string => {
  if (snapshot.tax_mode === 'MARGIN_SCHEME') {
    return `
      <div class="totals">
        <div class="total-row grand">
          <span>Gross:</span>
          <span>${escapeHtml(snapshot.total_gross)}</span>
        </div>
      </div>
      <div class="legal-line">Differenzbesteuerung gemäß § 24 UStG (Gebrauchtgegenstände).</div>
    `;
  }

  return `
    <div class="totals">
      <div class="total-row">
        <span>Net:</span>
        <span>${escapeHtml(snapshot.total_net)}</span>
      </div>
      <div class="total-row">
        <span>Tax:</span>
        <span>${escapeHtml(snapshot.total_tax)}</span>
      </div>
      <div class="total-row grand">
        <span>Gross:</span>
        <span>${escapeHtml(snapshot.total_gross)}</span>
      </div>
    </div>
  `;
};

export const buildInvoiceNotesSection = (
  snapshot: InvoiceSnapshot,
  escapeHtml: EscapeHtml,
): string => {
  if (!snapshot.notes) {
    return '';
  }

  return `
    <div class="section notes-container">
      <div class="section-title">Notes</div>
      <div>${escapeHtml(snapshot.notes)}</div>
    </div>
  `;
};

export const buildInvoiceHtmlDocument = (
  snapshot: InvoiceSnapshot,
  invoiceNumber: string,
  escapeHtml: EscapeHtml,
  formatDate: FormatDate,
): string => `
  <!DOCTYPE html>
  <html>
  <head>
    <style>${buildInvoiceDocumentStyles()}</style>
  </head>
  <body>
    ${buildInvoiceHeader(invoiceNumber, escapeHtml)}

    <div style="display: flex; justify-content: space-between;">
      ${buildInvoiceCustomerSection(snapshot, escapeHtml)}
      ${buildInvoiceMetaSection(snapshot, invoiceNumber, escapeHtml, formatDate)}
    </div>

    ${buildInvoiceVehicleSection(snapshot, escapeHtml)}
    ${buildInvoiceItemsTable(snapshot, escapeHtml)}
    ${buildInvoiceTotalsSection(snapshot, escapeHtml)}
    ${buildInvoiceNotesSection(snapshot, escapeHtml)}
  </body>
  </html>
`;

export const buildInvoiceFooterTemplate = (
  invoiceNumber: string,
  escape: EscapeHtml,
): string => buildPdfFooterTemplate(`Invoice ${escape(invoiceNumber)}`);
