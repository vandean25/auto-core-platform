import {
  buildBasePdfStyles,
  buildPdfFooterTemplate,
  type EscapeHtml,
} from '../common/pdf/pdf-layout.js';
import type { InvoiceSnapshot } from './invoice-snapshot.js';
import type { InvoiceSnapshotV2Seller } from './invoice-snapshot-v2.js';

export type { EscapeHtml };
export type FormatDate = (value: string | Date) => string;

export const isDachRechnungSnapshot = (snapshot: InvoiceSnapshot): boolean =>
  snapshot.schema_version === 2 && snapshot.seller !== undefined;

const buildCustomerName = (snapshot: InvoiceSnapshot): string =>
  snapshot.customer.type === 'COMPANY'
    ? (snapshot.customer.company_name ??
      `${snapshot.customer.first_name} ${snapshot.customer.last_name}`)
    : `${snapshot.customer.first_name} ${snapshot.customer.last_name}`;

const buildAddressLine = (
  street: string | null | undefined,
  line2: string | null | undefined,
  zip: string | null | undefined,
  city: string | null | undefined,
  escapeHtml: EscapeHtml,
): string => {
  const cityLine = [zip, city].filter(Boolean).join(' ');
  return `
    ${street ? `<div>${escapeHtml(street)}</div>` : ''}
    ${line2 ? `<div>${escapeHtml(line2)}</div>` : ''}
    ${cityLine ? `<div>${escapeHtml(cityLine)}</div>` : ''}
  `;
};

const buildSellerTaxLines = (
  seller: InvoiceSnapshotV2Seller,
  escapeHtml: EscapeHtml,
): string => {
  const lines: string[] = [];

  if (seller.country_iso === 'AT') {
    if (seller.vat_id) {
      lines.push(`UID: ${escapeHtml(seller.vat_id)}`);
    }
    if (seller.tax_number) {
      lines.push(`Steuernummer: ${escapeHtml(seller.tax_number)}`);
    }
  } else {
    if (seller.vat_id) {
      lines.push(`USt-IdNr.: ${escapeHtml(seller.vat_id)}`);
    }
    if (seller.tax_number) {
      lines.push(`Steuernummer: ${escapeHtml(seller.tax_number)}`);
    }
  }

  return lines.map((line) => `<div>${line}</div>`).join('');
};

const buildSellerBankLines = (
  seller: InvoiceSnapshotV2Seller,
  escapeHtml: EscapeHtml,
): string => {
  const lines: string[] = [];
  if (seller.bank_name) {
    lines.push(escapeHtml(seller.bank_name));
  }
  if (seller.iban) {
    lines.push(`IBAN: ${escapeHtml(seller.iban)}`);
  }
  if (seller.bic) {
    lines.push(`BIC: ${escapeHtml(seller.bic)}`);
  }
  return lines.map((line) => `<div>${line}</div>`).join('');
};

const buildSellerCorporateLines = (
  seller: InvoiceSnapshotV2Seller,
  escapeHtml: EscapeHtml,
): string => {
  const lines: string[] = [];
  if (seller.registration_court && seller.registration_number) {
    lines.push(
      `${escapeHtml(seller.registration_court)}, ${escapeHtml(seller.registration_number)}`,
    );
  } else if (seller.registration_number) {
    lines.push(escapeHtml(seller.registration_number));
  }
  if (seller.representatives) {
    lines.push(escapeHtml(seller.representatives));
  }
  if (seller.email) {
    lines.push(escapeHtml(seller.email));
  }
  if (seller.phone) {
    lines.push(escapeHtml(seller.phone));
  }
  return lines.map((line) => `<div>${line}</div>`).join('');
};

const buildSupplyDateLabel = (
  snapshot: InvoiceSnapshot,
  formatDate: FormatDate,
): string => {
  const from = snapshot.supply_date_from;
  const to = snapshot.supply_date_to ?? from;
  if (!from) {
    return '';
  }

  const fromLabel = formatDate(`${from}T00:00:00.000Z`);
  if (!to || from === to) {
    return `<div><strong>Leistungsdatum:</strong> ${fromLabel}</div>`;
  }

  const toLabel = formatDate(`${to}T00:00:00.000Z`);
  return `<div><strong>Leistungszeitraum:</strong> ${fromLabel} – ${toLabel}</div>`;
};

const buildLineDiscountLabel = (
  item: InvoiceSnapshot['items'][number],
): string | null => {
  if (!item.line_discount_type || !item.line_discount_value) {
    return null;
  }

  if (item.line_discount_type === 'PERCENTAGE') {
    const percentage = Number.parseFloat(item.line_discount_value);
    const formatted = Number.isFinite(percentage)
      ? String(percentage)
      : item.line_discount_value;
    return `Rabatt ${formatted}%`;
  }

  return `Rabatt ${item.line_discount_value}`;
};

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
  snapshot: InvoiceSnapshot,
): string => {
  const title = isDachRechnungSnapshot(snapshot) ? 'Rechnung' : 'Invoice';

  return `
  <div class="header">
    <h1>${title}</h1>
    <div class="muted">${escapeHtml(invoiceNumber)}</div>
  </div>
`;
};

export const buildInvoiceSellerSection = (
  snapshot: InvoiceSnapshot,
  escapeHtml: EscapeHtml,
): string => {
  if (!isDachRechnungSnapshot(snapshot) || !snapshot.seller) {
    return '';
  }

  const seller = snapshot.seller;

  return `
    <div class="section">
      <div style="font-weight: 700; font-size: 13px;">${escapeHtml(seller.name)}</div>
      ${buildAddressLine(
        seller.address_street,
        seller.address_line2,
        seller.address_zip,
        seller.address_city,
        escapeHtml,
      )}
      ${buildSellerTaxLines(seller, escapeHtml)}
      ${buildSellerBankLines(seller, escapeHtml)}
      ${buildSellerCorporateLines(seller, escapeHtml)}
    </div>
  `;
};

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
  const recipientLabel = isDachRechnungSnapshot(snapshot)
    ? 'Rechnungsempfänger'
    : 'Bill to:';
  const vatLabel = isDachRechnungSnapshot(snapshot) ? 'USt-IdNr.' : 'VAT ID';

  return `
    <div class="section">
      <div class="section-title">${recipientLabel}</div>
      <div style="font-weight: 600;">${escapeHtml(customerName)}</div>
      ${snapshot.customer.address_street ? `<div>${escapeHtml(snapshot.customer.address_street)}</div>` : ''}
      ${cityLine ? `<div>${escapeHtml(cityLine)}</div>` : ''}
      ${snapshot.customer.address_country ? `<div>${escapeHtml(snapshot.customer.address_country)}</div>` : ''}
      ${snapshot.customer.vat_id ? `<div>${vatLabel}: ${escapeHtml(snapshot.customer.vat_id)}</div>` : ''}
    </div>
  `;
};

export const buildInvoiceMetaSection = (
  snapshot: InvoiceSnapshot,
  invoiceNumber: string,
  escapeHtml: EscapeHtml,
  formatDate: FormatDate,
): string => {
  if (isDachRechnungSnapshot(snapshot)) {
    const paymentTerms = snapshot.payment_terms?.text
      ? `<div><strong>Zahlungsbedingungen:</strong> ${escapeHtml(snapshot.payment_terms.text)}</div>`
      : '';

    return `
      <div class="section" style="text-align: right">
        <div><strong>Rechnungsnummer:</strong> ${escapeHtml(invoiceNumber)}</div>
        <div><strong>Rechnungsdatum:</strong> ${escapeHtml(formatDate(snapshot.date))}</div>
        <div><strong>Fällig am:</strong> ${escapeHtml(formatDate(snapshot.due_date))}</div>
        ${buildSupplyDateLabel(snapshot, formatDate)}
        ${paymentTerms}
      </div>
    `;
  }

  return `
  <div class="section" style="text-align: right">
    <div><strong>Invoice Number:</strong> ${escapeHtml(invoiceNumber)}</div>
    <div><strong>Date:</strong> ${escapeHtml(formatDate(snapshot.date))}</div>
    <div><strong>Due Date:</strong> ${escapeHtml(formatDate(snapshot.due_date))}</div>
  </div>
`;
};

export const buildInvoiceVehicleSection = (
  snapshot: InvoiceSnapshot,
  escapeHtml: EscapeHtml,
): string => {
  if (!snapshot.vehicle) {
    return '';
  }

  const vehicle = snapshot.vehicle;
  const vehicleLabel = isDachRechnungSnapshot(snapshot) ? 'Fahrzeug' : 'Vehicle';
  const plateLabel = isDachRechnungSnapshot(snapshot) ? 'Kennzeichen' : 'Plate';
  const vinLabel = isDachRechnungSnapshot(snapshot) ? 'FIN' : 'VIN';

  return `
    <div class="section">
      <div class="section-title">${vehicleLabel}:</div>
      <div style="font-weight: 600;">${escapeHtml(vehicle.make)} ${escapeHtml(vehicle.model)} (${escapeHtml(vehicle.year)})</div>
      ${vehicle.plate ? `<div>${plateLabel}: <strong>${escapeHtml(vehicle.plate)}</strong></div>` : ''}
      ${vehicle.vin ? `<div>${vinLabel}: <span style="font-family: monospace;">${escapeHtml(vehicle.vin)}</span></div>` : ''}
    </div>
  `;
};

export const buildInvoiceItemsTable = (
  snapshot: InvoiceSnapshot,
  escapeHtml: EscapeHtml,
): string => {
  const isDach = isDachRechnungSnapshot(snapshot);
  const descriptionLabel = isDach ? 'Beschreibung' : 'Description';
  const quantityLabel = isDach ? 'Menge' : 'Qty';
  const unitPriceLabel = isDach ? 'Einzelpreis' : 'Unit Price';
  const totalLabel = isDach ? 'Gesamt' : 'Total';

  const itemsHtml = snapshot.items
    .map((item) => {
      const discountLabel = buildLineDiscountLabel(item);
      const description = discountLabel
        ? `${item.description} (${discountLabel})`
        : item.description;

      return `
      <tr>
        <td>${escapeHtml(description)}</td>
        <td style="text-align: right">${escapeHtml(item.quantity)}</td>
        <td style="text-align: right">${escapeHtml(item.unit_price)}</td>
        <td style="text-align: right">${escapeHtml(item.line_total ?? '')}</td>
      </tr>
    `;
    })
    .join('');

  return `
    <table>
      <thead>
        <tr>
          <th>${descriptionLabel}</th>
          <th style="text-align: right; width: 80px;">${quantityLabel}</th>
          <th style="text-align: right; width: 100px;">${unitPriceLabel}</th>
          <th style="text-align: right; width: 100px;">${totalLabel}</th>
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
    const grossLabel = isDachRechnungSnapshot(snapshot) ? 'Brutto:' : 'Gross:';

    return `
      <div class="totals">
        <div class="total-row grand">
          <span>${grossLabel}</span>
          <span>${escapeHtml(snapshot.total_gross)}</span>
        </div>
      </div>
      <div class="legal-line">Differenzbesteuerung gemäß § 24 UStG (Gebrauchtgegenstände).</div>
    `;
  }

  if (isDachRechnungSnapshot(snapshot)) {
    return `
    <div class="totals">
      <div class="total-row">
        <span>Netto:</span>
        <span>${escapeHtml(snapshot.total_net)}</span>
      </div>
      <div class="total-row">
        <span>Umsatzsteuer:</span>
        <span>${escapeHtml(snapshot.total_tax)}</span>
      </div>
      <div class="total-row grand">
        <span>Brutto:</span>
        <span>${escapeHtml(snapshot.total_gross)}</span>
      </div>
    </div>
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

  const notesLabel = isDachRechnungSnapshot(snapshot) ? 'Anmerkungen' : 'Notes';

  return `
    <div class="section notes-container">
      <div class="section-title">${notesLabel}</div>
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
    ${buildInvoiceHeader(invoiceNumber, escapeHtml, snapshot)}

    <div style="display: flex; justify-content: space-between;">
      ${buildInvoiceSellerSection(snapshot, escapeHtml)}
      ${buildInvoiceMetaSection(snapshot, invoiceNumber, escapeHtml, formatDate)}
    </div>

    ${buildInvoiceCustomerSection(snapshot, escapeHtml)}
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
  snapshot: InvoiceSnapshot,
): string => {
  const prefix = isDachRechnungSnapshot(snapshot) ? 'Rechnung' : 'Invoice';
  return buildPdfFooterTemplate(`${prefix} ${escape(invoiceNumber)}`);
};
