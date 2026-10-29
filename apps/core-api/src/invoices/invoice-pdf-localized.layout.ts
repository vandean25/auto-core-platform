import type { TFunction } from 'i18next';
import type { EscapeHtml, FormatDate } from './invoice-pdf.layout.js';
import {
  buildInvoiceDocumentStyles,
  buildInvoiceHtmlDocument,
  buildInvoiceSellerSection,
  buildInvoiceTotalsSection,
  createInvoicePdfNumberFormatter,
  isCreditNoteSnapshot,
  isDachRechnungSnapshot,
} from './invoice-pdf.layout.js';
import type { InvoiceSnapshot } from './invoice-snapshot.js';
import { buildAuthoritativeGermanLegalNoticeHtml } from '../common/i18n/pdf-legal-notice.js';
import type { DisplayLanguage } from '../common/i18n/display-language.js';

export type LocalizedInvoicePdfContext = {
  locale: DisplayLanguage;
  t: TFunction;
};

function localizedHeader(
  invoiceNumber: string,
  escapeHtml: EscapeHtml,
  snapshot: InvoiceSnapshot,
  t: TFunction,
): string {
  const title = isCreditNoteSnapshot(snapshot)
    ? t('invoice.creditTitle')
    : t('invoice.title');

  return `
  <div class="header">
    <h1>${escapeHtml(title)}</h1>
    <div class="muted">${escapeHtml(invoiceNumber)}</div>
  </div>
`;
}

function localizedMetaSection(
  snapshot: InvoiceSnapshot,
  invoiceNumber: string,
  escapeHtml: EscapeHtml,
  formatDate: FormatDate,
  t: TFunction,
): string {
  const paymentTerms =
    !isCreditNoteSnapshot(snapshot) && snapshot.payment_terms?.text
      ? `<div><strong>${escapeHtml(t('invoice.paymentTermsLabel'))}:</strong> ${escapeHtml(snapshot.payment_terms.text)}</div>`
      : '';
  const numberLabel = isCreditNoteSnapshot(snapshot)
    ? t('invoice.creditNumberLabel')
    : t('invoice.invoiceNumberLabel');
  const dateLabel = isCreditNoteSnapshot(snapshot)
    ? t('invoice.creditDateLabel')
    : t('invoice.invoiceDateLabel');
  const dueDateLine = isCreditNoteSnapshot(snapshot)
    ? ''
    : `<div><strong>${escapeHtml(t('invoice.dueDateLabel'))}:</strong> ${escapeHtml(formatDate(snapshot.due_date))}</div>`;

  const from = snapshot.supply_date_from;
  const to = snapshot.supply_date_to ?? from;
  let supplyLine = '';
  if (from) {
    const fromLabel = formatDate(`${from}T00:00:00.000Z`);
    if (!to || from === to) {
      supplyLine = `<div><strong>${escapeHtml(t('invoice.supplyDateLabel'))}:</strong> ${escapeHtml(fromLabel)}</div>`;
    } else {
      const toLabel = formatDate(`${to}T00:00:00.000Z`);
      supplyLine = `<div><strong>${escapeHtml(t('invoice.supplyPeriodLabel'))}:</strong> ${escapeHtml(fromLabel)} – ${escapeHtml(toLabel)}</div>`;
    }
  }

  return `
      <div class="section" style="text-align: right">
        <div><strong>${escapeHtml(numberLabel)}:</strong> ${escapeHtml(invoiceNumber)}</div>
        <div><strong>${escapeHtml(dateLabel)}:</strong> ${escapeHtml(formatDate(snapshot.date))}</div>
        ${dueDateLine}
        ${supplyLine}
        ${paymentTerms}
      </div>
    `;
}

function localizedCustomerSection(
  snapshot: InvoiceSnapshot,
  escapeHtml: EscapeHtml,
  t: TFunction,
): string {
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
  const vatLabel =
    snapshot.seller?.country_iso === 'AT'
      ? t('invoice.uidLabel')
      : t('invoice.vatIdLabel');

  return `
    <div class="section">
      <div class="section-title">${escapeHtml(t('invoice.recipientLabel'))}</div>
      <div style="font-weight: 600;">${escapeHtml(customerName)}</div>
      ${snapshot.customer.address_street ? `<div>${escapeHtml(snapshot.customer.address_street)}</div>` : ''}
      ${cityLine ? `<div>${escapeHtml(cityLine)}</div>` : ''}
      ${snapshot.customer.address_country ? `<div>${escapeHtml(snapshot.customer.address_country)}</div>` : ''}
      ${snapshot.customer.vat_id ? `<div>${escapeHtml(vatLabel)}: ${escapeHtml(snapshot.customer.vat_id)}</div>` : ''}
    </div>
  `;
}

function localizedItemsTable(
  snapshot: InvoiceSnapshot,
  escapeHtml: EscapeHtml,
  t: TFunction,
): string {
  const numbers = createInvoicePdfNumberFormatter(snapshot);
  const itemsHtml = snapshot.items
    .map((item) => {
      let discountSuffix = '';
      if (item.line_discount_type && item.line_discount_value) {
        if (item.line_discount_type === 'PERCENTAGE') {
          discountSuffix = ` (${t('invoice.lineDiscountPercent', { value: numbers.formatRate(item.line_discount_value) })})`;
        } else {
          discountSuffix = ` (${t('invoice.lineDiscountAmount', { value: numbers.formatAmount(item.line_discount_value) })})`;
        }
      }
      const description = `${item.description}${discountSuffix}`;

      return `
      <tr>
        <td>${escapeHtml(description)}</td>
        <td style="text-align: right">${escapeHtml(numbers.formatQuantity(item.quantity))}</td>
        <td style="text-align: right">${escapeHtml(numbers.formatAmount(item.unit_price))}</td>
        <td style="text-align: right">${escapeHtml(numbers.formatAmount(item.line_total))}</td>
      </tr>
    `;
    })
    .join('');

  return `
    <table>
      <thead>
        <tr>
          <th>${escapeHtml(t('invoice.descriptionHeader'))}</th>
          <th style="text-align: right; width: 80px;">${escapeHtml(t('invoice.quantityHeader'))}</th>
          <th style="text-align: right; width: 100px;">${escapeHtml(t('invoice.unitPriceHeader'))}</th>
          <th style="text-align: right; width: 100px;">${escapeHtml(t('invoice.totalHeader'))}</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>
  `;
}

function localizedTaxBreakdownSection(
  snapshot: InvoiceSnapshot,
  escapeHtml: EscapeHtml,
  t: TFunction,
): string {
  if (
    snapshot.tax_mode === 'MARGIN_SCHEME' ||
    !isDachRechnungSnapshot(snapshot) ||
    !snapshot.tax_breakdown?.length
  ) {
    return '';
  }

  const numbers = createInvoicePdfNumberFormatter(snapshot);
  const rows = snapshot.tax_breakdown
    .map(
      (bucket) => `
      <div class="total-row tax-rate-row">
        <span>${escapeHtml(
          t('invoice.taxRateRow', {
            rate: numbers.formatRate(bucket.rate),
            net: numbers.formatAmount(bucket.net),
          }),
        )}:</span>
        <span>${escapeHtml(numbers.formatAmount(bucket.tax))}</span>
      </div>
    `,
    )
    .join('');

  return `
    <div class="tax-breakdown">
      <div class="section-title">${escapeHtml(t('invoice.taxBreakdownTitle'))}</div>
      ${rows}
    </div>
  `;
}

function localizedTotalsSection(
  snapshot: InvoiceSnapshot,
  escapeHtml: EscapeHtml,
  t: TFunction,
): string {
  if (snapshot.tax_mode === 'MARGIN_SCHEME') {
    return buildInvoiceTotalsSection(snapshot, escapeHtml);
  }

  const taxBreakdown = localizedTaxBreakdownSection(snapshot, escapeHtml, t);
  const numbers = createInvoicePdfNumberFormatter(snapshot);

  return `
    ${taxBreakdown}
    <div class="totals">
      <div class="total-row">
        <span>${escapeHtml(t('invoice.netLabel'))}:</span>
        <span>${escapeHtml(numbers.formatAmount(snapshot.total_net))}</span>
      </div>
      <div class="total-row">
        <span>${escapeHtml(t('invoice.taxLabel'))}:</span>
        <span>${escapeHtml(numbers.formatAmount(snapshot.total_tax))}</span>
      </div>
      <div class="total-row grand">
        <span>${escapeHtml(t('invoice.grossLabel'))}:</span>
        <span>${escapeHtml(numbers.formatAmount(snapshot.total_gross))}</span>
      </div>
    </div>
  `;
}

function localizedCreditNoteOriginalReferenceSection(
  snapshot: InvoiceSnapshot,
  escapeHtml: EscapeHtml,
  formatDate: FormatDate,
  t: TFunction,
): string {
  if (!isCreditNoteSnapshot(snapshot) || !snapshot.original_document) {
    return '';
  }

  const original = snapshot.original_document;
  const originalDate = formatDate(`${original.date}T00:00:00.000Z`);

  return `
    <div class="section" style="margin-bottom: 18px; padding: 12px 14px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px;">
      <div class="section-title">${escapeHtml(t('invoice.creditReferenceTitle'))}</div>
      <div><strong>${escapeHtml(t('invoice.originalNumberLabel'))}:</strong> ${escapeHtml(original.number)}</div>
      <div><strong>${escapeHtml(t('invoice.originalDateLabel'))}:</strong> ${escapeHtml(originalDate)}</div>
      <div><strong>${escapeHtml(t('invoice.originalReasonLabel'))}:</strong> ${escapeHtml(original.reason)}</div>
    </div>
  `;
}

function localizedVehicleSection(
  snapshot: InvoiceSnapshot,
  escapeHtml: EscapeHtml,
  t: TFunction,
): string {
  if (!snapshot.vehicle) {
    return '';
  }

  const vehicle = snapshot.vehicle;

  return `
    <div class="section">
      <div class="section-title">${escapeHtml(t('invoice.vehicleSectionTitle'))}:</div>
      <div style="font-weight: 600;">${escapeHtml(vehicle.make)} ${escapeHtml(vehicle.model)} (${escapeHtml(vehicle.year)})</div>
      ${vehicle.plate ? `<div>${escapeHtml(t('invoice.plateLabel'))}: <strong>${escapeHtml(vehicle.plate)}</strong></div>` : ''}
      ${vehicle.vin ? `<div>${escapeHtml(t('invoice.vinLabel'))}: <span style="font-family: monospace;">${escapeHtml(vehicle.vin)}</span></div>` : ''}
    </div>
  `;
}

function localizedNotesSection(
  snapshot: InvoiceSnapshot,
  escapeHtml: EscapeHtml,
  t: TFunction,
): string {
  if (!snapshot.notes) {
    return '';
  }

  return `
    <div class="section notes-container">
      <div class="section-title">${escapeHtml(t('invoice.notesTitle'))}</div>
      <div>${escapeHtml(snapshot.notes)}</div>
    </div>
  `;
}

export function buildLocalizedInvoiceHtmlDocument(
  snapshot: InvoiceSnapshot,
  invoiceNumber: string,
  escapeHtml: EscapeHtml,
  formatDate: FormatDate,
  ctx: LocalizedInvoicePdfContext,
  options: { branded?: boolean; fontFaceCss?: string } = {},
): string {
  const { t, locale } = ctx;
  const legalNotice = buildAuthoritativeGermanLegalNoticeHtml(locale);

  return `
  <!DOCTYPE html>
  <html lang="${escapeHtml(t('invoice.htmlLang'))}">
  <head>
    <style>${buildInvoiceDocumentStyles(options.branded, options.fontFaceCss, snapshot)}</style>
  </head>
  <body>
    ${localizedHeader(invoiceNumber, escapeHtml, snapshot, t)}
    ${localizedCreditNoteOriginalReferenceSection(snapshot, escapeHtml, formatDate, t)}
    <div style="display: flex; justify-content: space-between;">
      ${buildInvoiceSellerSection(snapshot, escapeHtml)}
      ${localizedMetaSection(snapshot, invoiceNumber, escapeHtml, formatDate, t)}
    </div>
    ${localizedCustomerSection(snapshot, escapeHtml, t)}
    ${localizedVehicleSection(snapshot, escapeHtml, t)}
    ${localizedItemsTable(snapshot, escapeHtml, t)}
    ${localizedTotalsSection(snapshot, escapeHtml, t)}
    ${localizedNotesSection(snapshot, escapeHtml, t)}
    ${legalNotice}
  </body>
  </html>
`;
}

export function buildInvoiceHtmlDocumentForSnapshot(
  snapshot: InvoiceSnapshot,
  invoiceNumber: string,
  escapeHtml: EscapeHtml,
  formatDate: FormatDate,
  ctx: LocalizedInvoicePdfContext | null,
  options: { branded?: boolean; fontFaceCss?: string } = {},
): string {
  if (!ctx) {
    return buildInvoiceHtmlDocument(
      snapshot,
      invoiceNumber,
      escapeHtml,
      formatDate,
      options,
    );
  }
  return buildLocalizedInvoiceHtmlDocument(
    snapshot,
    invoiceNumber,
    escapeHtml,
    formatDate,
    ctx,
    options,
  );
}
