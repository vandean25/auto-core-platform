import type { WorkshopLineItemType } from '@prisma/client';
import type { TFunction } from 'i18next';
import {
  buildBasePdfStyles,
  type EscapeHtml,
} from '../common/pdf/pdf-layout.js';
import { createPdfTranslator } from '../common/i18n/pdf-i18n.js';
import { snapshotUsesLocalizedPdfResources } from '../common/i18n/pdf-resource-bundle.js';
import {
  FOOTER_DECORATIVE_MAX_LINES,
  FOOTER_DECORATIVE_WIDTH_MM,
  HEADER_DECORATIVE_MAX_LINES,
  HEADER_DECORATIVE_WIDTH_MM,
  wrapAndEllipsizeDecorativeText,
} from '../document-branding/decorative-text-layout.js';
import {
  formatWorkshopEstimateDate,
  formatWorkshopEstimateValidUntil,
  type WorkshopEstimateSnapshot,
} from './workshop-estimate-snapshot.js';
import type { WorkshopEstimateLine } from './workshop-estimate-lines.helpers.js';
import { buildAuthoritativeGermanLegalNoticeHtml } from '../common/i18n/pdf-legal-notice.js';
import { resolveDocumentLanguage } from '../common/i18n/locale-resolution.js';

const DEFAULT_COLOR = '#111827';
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const LEGACY_LINE_TYPE_LABEL: Record<WorkshopLineItemType, string> = {
  LABOR: 'Arbeitsleistung',
  PART: 'Ersatzteil',
  FEE: 'Nebenleistung',
};

const ESTIMATE_LINE_TYPE_KEY: Record<
  WorkshopLineItemType,
  'estimate.lineTypeLabor' | 'estimate.lineTypePart' | 'estimate.lineTypeFee'
> = {
  LABOR: 'estimate.lineTypeLabor',
  PART: 'estimate.lineTypePart',
  FEE: 'estimate.lineTypeFee',
};

function resolveEstimatePdfTranslator(
  snapshot: WorkshopEstimateSnapshot,
): TFunction | null {
  if (!snapshotUsesLocalizedPdfResources(snapshot)) {
    return null;
  }
  return createPdfTranslator(resolveDocumentLanguage(snapshot));
}

function lineTypeLabel(
  type: WorkshopLineItemType,
  t: TFunction | null,
): string {
  if (!t) {
    return LEGACY_LINE_TYPE_LABEL[type];
  }
  return t(ESTIMATE_LINE_TYPE_KEY[type]);
}

const MONEY_FORMAT = new Intl.NumberFormat('de-AT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const DECIMAL_FORMAT = new Intl.NumberFormat('de-AT', {
  maximumFractionDigits: 3,
});

/** Display only: the money values are already rounded strings from the frozen snapshot. */
export function formatEstimateMoney(value: string): string {
  return `${MONEY_FORMAT.format(Number(value))} €`;
}

function formatEstimateRate(value: string): string {
  return `${DECIMAL_FORMAT.format(Number(value))} %`;
}

/** Branding colours come from the frozen snapshot. Only a six-digit hex value reaches the CSS. */
function safeColor(value: string | undefined): string {
  return value && HEX_COLOR.test(value) ? value : DEFAULT_COLOR;
}

function bandColor(
  band: 'none' | 'primary' | 'secondary',
  tokens: { primary_color: string; secondary_color: string },
): string {
  if (band === 'primary') return safeColor(tokens.primary_color);
  if (band === 'secondary') return safeColor(tokens.secondary_color);
  return 'transparent';
}

function renderLines(
  lines: Array<string | null | undefined>,
  escape: EscapeHtml,
): string {
  return lines
    .filter((line): line is string => Boolean(line && line.trim()))
    .map((line) => `<div>${escape(line)}</div>`)
    .join('');
}

function buildWorkshopEstimateStyles(primary: string): string {
  return `
  body { font-family: 'ACP Sans', sans-serif; color: #111827; }
  h1 { font-size: 22px; margin: 0; letter-spacing: 0.2px; color: ${primary}; }
  .header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 16px; }
  .header .muted { color: #6b7280; font-size: 12px; }

  .meta { width: 100%; margin: 0 0 16px; }
  .meta td { padding: 3px 0; font-size: 11px; border: 0; }
  .meta td:first-child { color: #6b7280; width: 32%; }

  .parties { display: flex; gap: 20px; margin-bottom: 16px; }
  .party { flex: 1; font-size: 11px; line-height: 1.45; break-inside: avoid; }
  .party-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: ${primary}; margin-bottom: 4px; }

  table.items { margin: 12px 0; table-layout: fixed; }
  table.items th { padding: 8px 6px; font-size: 10px; font-weight: 700; color: #374151; background: #f9fafb; text-align: left; }
  table.items td { padding: 8px 6px; font-size: 11px; vertical-align: top; word-break: break-word; }
  .num { text-align: right; white-space: nowrap; }
  .kind { display: block; font-size: 9px; color: #6b7280; }

  .totals { margin-left: auto; width: 260px; break-inside: avoid; }
  .total-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 11px; }
  .total-row.grand { font-weight: 800; font-size: 13px; border-top: 1px solid #d1d5db; margin-top: 6px; padding-top: 8px; }

  table.tax-breakdown { margin: 12px 0 0 auto; width: 380px; break-inside: avoid; table-layout: fixed; }
  table.tax-breakdown th { padding: 4px 6px; font-size: 10px; color: #374151; background: #f9fafb; text-align: right; }
  table.tax-breakdown td { padding: 4px 6px; font-size: 10px; text-align: right; }

  .legal { margin-top: 22px; font-size: 10px; color: #374151; break-inside: avoid; }
  .legal p { margin: 0 0 6px; }
`;
}

function buildTitleSection(
  snapshot: WorkshopEstimateSnapshot,
  escape: EscapeHtml,
  t: TFunction | null,
): string {
  const title = t ? t('estimate.title') : snapshot.document.title;
  const versionLine = t
    ? `${escape(snapshot.document.estimate_number)} · ${escape(t('estimate.versionLabel', { version: snapshot.document.version }))}`
    : `${escape(snapshot.document.estimate_number)} · Version ${escape(snapshot.document.version)}`;
  return `
  <div class="header">
    <h1>${escape(title)}</h1>
    <div class="muted">${versionLine}</div>
  </div>`;
}

function buildMetaSection(
  snapshot: WorkshopEstimateSnapshot,
  escape: EscapeHtml,
  t: TFunction | null,
): string {
  const issued = formatWorkshopEstimateDate(
    new Date(snapshot.document.issued_at),
  );
  const validUntilSuffix = t ? t('estimate.validUntilTimeSuffix') : ' Uhr';
  const validUntil = `${formatWorkshopEstimateValidUntil(new Date(snapshot.document.valid_until))}${validUntilSuffix}`;
  const odometer = `${new Intl.NumberFormat('de-AT').format(snapshot.order.odometer)} km`;
  const dateLabel = t ? t('estimate.dateLabel') : 'Datum';
  const validUntilLabel = t ? t('estimate.validUntilLabel') : 'Gültig bis';
  const orderLabel = t ? t('estimate.orderLabel') : 'Auftrag';
  const odometerLabel = t ? t('estimate.odometerLabel') : 'Kilometerstand';
  return `
  <table class="meta">
    <tr><td>${escape(dateLabel)}</td><td>${escape(issued)}</td></tr>
    <tr><td>${escape(validUntilLabel)}</td><td>${escape(validUntil)}</td></tr>
    <tr><td>${escape(orderLabel)}</td><td>${escape(snapshot.order.order_number)}</td></tr>
    <tr><td>${escape(odometerLabel)}</td><td>${escape(odometer)}</td></tr>
  </table>`;
}

function buildPartiesSection(
  snapshot: WorkshopEstimateSnapshot,
  escape: EscapeHtml,
  t: TFunction | null,
): string {
  const { seller, customer, vehicle } = snapshot;
  const sellerTaxLine = seller.vat_id
    ? t
      ? t('estimate.uidLine', { value: seller.vat_id })
      : `UID: ${seller.vat_id}`
    : seller.tax_number
      ? t
        ? t('estimate.taxNumberLine', { value: seller.tax_number })
        : `Steuernummer: ${seller.tax_number}`
      : null;
  const customerName = [customer.first_name, customer.last_name]
    .filter(Boolean)
    .join(' ');
  const providerLabel = t ? t('estimate.providerLabel') : 'Anbieter';
  const customerLabel = t ? t('estimate.customerLabel') : 'Kunde';
  const vehicleLabel = t ? t('estimate.vehicleLabel') : 'Fahrzeug';
  const customerVatLine = customer.vat_id
    ? t
      ? t('estimate.uidLine', { value: customer.vat_id })
      : `UID: ${customer.vat_id}`
    : null;
  const vehicleYearLine =
    vehicle.year && t
      ? t('estimate.yearLabel', { year: vehicle.year })
      : vehicle.year
        ? `Baujahr ${vehicle.year}`
        : null;
  const vehiclePlateLine =
    vehicle.plate && t
      ? t('estimate.plateLine', { plate: vehicle.plate })
      : vehicle.plate
        ? `Kennzeichen: ${vehicle.plate}`
        : null;
  const vehicleVinLine =
    vehicle.vin && t
      ? t('estimate.vinLine', { vin: vehicle.vin })
      : vehicle.vin
        ? `FIN: ${vehicle.vin}`
        : null;
  const sellerPhoneLine =
    seller.phone && t
      ? t('estimate.phoneLine', { phone: seller.phone })
      : seller.phone
        ? `Tel.: ${seller.phone}`
        : null;
  return `
  <div class="parties">
    <div class="party">
      <div class="party-title">${escape(providerLabel)}</div>
      ${renderLines(
        [
          seller.name,
          seller.address_street,
          seller.address_line2,
          [seller.address_zip, seller.address_city].filter(Boolean).join(' '),
          sellerTaxLine,
          sellerPhoneLine,
          seller.email,
        ],
        escape,
      )}
    </div>
    <div class="party">
      <div class="party-title">${escape(customerLabel)}</div>
      ${renderLines(
        [
          customer.company_name,
          customerName,
          customer.address_street,
          [customer.address_zip, customer.address_city]
            .filter(Boolean)
            .join(' '),
          customer.address_country,
          customerVatLine,
          customer.email,
          customer.phone,
        ],
        escape,
      )}
    </div>
    <div class="party">
      <div class="party-title">${escape(vehicleLabel)}</div>
      ${renderLines(
        [
          [vehicle.make, vehicle.model].filter(Boolean).join(' '),
          vehicleYearLine,
          vehiclePlateLine,
          vehicleVinLine,
        ],
        escape,
      )}
    </div>
  </div>`;
}

type LineCell = { html: string; numeric: boolean };

function buildLineCells(
  line: WorkshopEstimateLine,
  grossDisplay: boolean,
  escape: EscapeHtml,
  t: TFunction | null,
): LineCell[] {
  const description = `<span class="kind">${escape(lineTypeLabel(line.type, t))}</span>${escape(line.description)}`;
  const quantity = {
    html: escape(DECIMAL_FORMAT.format(Number(line.quantity))),
    numeric: true,
  };
  const rate = {
    html: escape(formatEstimateRate(line.tax_rate)),
    numeric: true,
  };
  if (grossDisplay) {
    return [
      { html: escape(line.item_no), numeric: false },
      { html: description, numeric: false },
      quantity,
      rate,
      { html: escape(formatEstimateMoney(line.gross)), numeric: true },
    ];
  }
  return [
    { html: escape(line.item_no), numeric: false },
    { html: description, numeric: false },
    quantity,
    { html: escape(formatEstimateMoney(line.unit_price)), numeric: true },
    rate,
    { html: escape(formatEstimateMoney(line.net)), numeric: true },
  ];
}

function buildLinesSection(
  snapshot: WorkshopEstimateSnapshot,
  escape: EscapeHtml,
  t: TFunction | null,
): string {
  const grossDisplay = snapshot.document.price_display === 'GROSS';
  const headers = grossDisplay
    ? t
      ? [
          t('estimate.lineNoHeader'),
          t('estimate.lineDescriptionHeader'),
          t('estimate.quantityHeader'),
          t('estimate.taxRateHeader'),
          t('estimate.grossAmountHeader'),
        ]
      : ['Nr.', 'Bezeichnung', 'Menge', 'USt', 'Betrag brutto']
    : t
      ? [
          t('estimate.lineNoHeader'),
          t('estimate.lineDescriptionHeader'),
          t('estimate.quantityHeader'),
          t('estimate.netUnitPriceHeader'),
          t('estimate.taxRateHeader'),
          t('estimate.netAmountHeader'),
        ]
      : [
          'Nr.',
          'Bezeichnung',
          'Menge',
          'Einzelpreis netto',
          'USt',
          'Betrag netto',
        ];
  const headerRow = headers
    .map(
      (header, index) =>
        `<th${index >= 2 ? ' class="num"' : ''}>${escape(header)}</th>`,
    )
    .join('');
  const bodyRows = snapshot.lines
    .map((line) => {
      const cells = buildLineCells(line, grossDisplay, escape, t)
        .map(
          (cell) =>
            `<td${cell.numeric ? ' class="num"' : ''}>${cell.html}</td>`,
        )
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  return `
  <table class="items">
    <thead><tr>${headerRow}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>`;
}

function buildTotalsSection(
  snapshot: WorkshopEstimateSnapshot,
  escape: EscapeHtml,
  t: TFunction | null,
): string {
  const { total_net, total_tax, total_gross } = snapshot.totals;
  const netLabel = t ? t('estimate.totalsNetAmount') : 'Nettobetrag';
  const taxLabel = t ? t('estimate.totalsTax') : 'Umsatzsteuer';
  const grossLabel = t ? t('estimate.totalsGross') : 'Gesamtbetrag brutto';
  return `
  <div class="totals">
    <div class="total-row"><span>${escape(netLabel)}</span><span>${escape(formatEstimateMoney(total_net))}</span></div>
    <div class="total-row"><span>${escape(taxLabel)}</span><span>${escape(formatEstimateMoney(total_tax))}</span></div>
    <div class="total-row grand"><span>${escape(grossLabel)}</span><span>${escape(formatEstimateMoney(total_gross))}</span></div>
  </div>`;
}

function buildTaxBreakdownSection(
  snapshot: WorkshopEstimateSnapshot,
  escape: EscapeHtml,
  t: TFunction | null,
): string {
  const buckets = snapshot.totals.tax_breakdown;
  if (buckets.length === 0) return '';
  const rateHeader = t ? t('estimate.taxBreakdownRateHeader') : 'USt-Satz';
  const netHeader = t ? t('estimate.taxBreakdownNetHeader') : 'Netto';
  const taxHeader = t ? t('estimate.taxBreakdownTaxHeader') : 'USt';
  const grossHeader = t ? t('estimate.taxBreakdownGrossHeader') : 'Brutto';
  const rows = buckets
    .map(
      (bucket) => `<tr>
      <td>${escape(formatEstimateRate(bucket.rate))}</td>
      <td>${escape(formatEstimateMoney(bucket.net))}</td>
      <td>${escape(formatEstimateMoney(bucket.tax))}</td>
      <td>${escape(formatEstimateMoney(bucket.gross))}</td>
    </tr>`,
    )
    .join('');
  return `
  <table class="tax-breakdown">
    <thead><tr><th>${escape(rateHeader)}</th><th>${escape(netHeader)}</th><th>${escape(taxHeader)}</th><th>${escape(grossHeader)}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/** The legal paragraphs are the frozen text of the version (kv-legal-de-v1), printed as stored. */
function buildLegalSection(
  snapshot: WorkshopEstimateSnapshot,
  escape: EscapeHtml,
): string {
  const paragraphs = snapshot.legal.paragraphs
    .map((paragraph) => `<p>${escape(paragraph)}</p>`)
    .join('');
  return `<div class="legal">${paragraphs}</div>`;
}

/** Full document for the body pages. The branded header and footer are separate templates. */
export function buildWorkshopEstimateHtmlDocument(
  snapshot: WorkshopEstimateSnapshot,
  fontFaceCss: string,
  escape: EscapeHtml,
): string {
  const primary = safeColor(snapshot.branding.tokens.primary_color);
  const documentLocale = resolveDocumentLanguage(snapshot);
  const t = resolveEstimatePdfTranslator(snapshot);
  const legalNotice = buildAuthoritativeGermanLegalNoticeHtml(documentLocale);
  const htmlLang = t
    ? t('estimate.htmlLang')
    : documentLocale === 'en'
      ? 'en'
      : 'de-AT';
  return `<!doctype html>
<html lang="${htmlLang}">
<head>
<meta charset="utf-8" />
<style>
${fontFaceCss}
${buildBasePdfStyles()}
${buildWorkshopEstimateStyles(primary)}
</style>
</head>
<body>
${buildTitleSection(snapshot, escape, t)}
${buildMetaSection(snapshot, escape, t)}
${buildPartiesSection(snapshot, escape, t)}
${buildLinesSection(snapshot, escape, t)}
${buildTotalsSection(snapshot, escape, t)}
${buildTaxBreakdownSection(snapshot, escape, t)}
${legalNotice}
${buildLegalSection(snapshot, escape)}
</body>
</html>`;
}

/** Page header on every page: frozen band, logo (when pinned) and the header text. */
export function buildWorkshopEstimateHeaderTemplate(
  snapshot: WorkshopEstimateSnapshot,
  logoDataUrl: string | null,
  escape: EscapeHtml,
  fontFaceCss = '',
): string {
  const { tokens } = snapshot.branding;
  const headerText = wrapAndEllipsizeDecorativeText(
    tokens.header_text,
    HEADER_DECORATIVE_WIDTH_MM,
    HEADER_DECORATIVE_MAX_LINES,
  )
    .lines.map(
      (line) =>
        `<span style="display:block;white-space:nowrap">${escape(line)}</span>`,
    )
    .join('');
  return `<style>${fontFaceCss}</style><div style="width:100%;height:32mm;padding:3mm 16mm 0;box-sizing:border-box;font-family:'ACP Sans',sans-serif;">
    <div style="height:3mm;background:${bandColor(tokens.header_band, tokens)};-webkit-print-color-adjust:exact;print-color-adjust:exact;margin:0 -16mm 2mm"></div>
    <div style="height:18mm;display:flex;align-items:center;justify-content:space-between;gap:8mm;">
      ${logoDataUrl ? `<img alt="" src="${escape(logoDataUrl)}" style="width:45mm;height:18mm;object-fit:contain;object-position:left center" />` : '<span></span>'}
      <span style="display:block;max-width:${HEADER_DECORATIVE_WIDTH_MM}mm;max-height:16mm;overflow:hidden;text-align:right;color:${safeColor(tokens.primary_color)};font-size:9pt;line-height:1.2">${headerText}</span>
    </div>
  </div>`;
}

/** Page footer on every page: frozen footer band, footer text, estimate number and version, and page numbers. */
export function buildWorkshopEstimateFooterTemplate(
  snapshot: WorkshopEstimateSnapshot,
  escape: EscapeHtml,
  fontFaceCss = '',
): string {
  const { tokens } = snapshot.branding;
  const footerText =
    wrapAndEllipsizeDecorativeText(
      tokens.footer_text,
      FOOTER_DECORATIVE_WIDTH_MM,
      FOOTER_DECORATIVE_MAX_LINES,
    ).lines[0] ?? '';
  const label = `${snapshot.document.title} ${snapshot.document.estimate_number} · Version ${snapshot.document.version}`;
  return `<style>${fontFaceCss}</style><div style="width:100%;height:28mm;padding:0 16mm 4mm;box-sizing:border-box;font-family:'ACP Sans',sans-serif;font-size:8pt;color:#6b7280;">
    <div style="height:3mm;background:${bandColor(tokens.footer_band, tokens)};-webkit-print-color-adjust:exact;print-color-adjust:exact;margin:0 -16mm 2mm"></div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8mm;max-height:16mm;overflow:hidden">
      <span style="max-width:${FOOTER_DECORATIVE_WIDTH_MM}mm;overflow:hidden;white-space:nowrap;font-size:9pt">${escape(footerText)}</span>
      <span>${escape(label)} · <span class="pageNumber"></span> / <span class="totalPages"></span></span>
    </div>
  </div>`;
}
