import type { WeeklyReportData } from './weekly-report-data.service.js';
import {
  formatDecimalString,
  formatEurAmount,
  formatPercent,
} from './weekly-report-format.util.js';
import {
  formatSiteLocalDate,
  formatSiteLocalDateTime,
  periodLabelForPdf,
} from './weekly-report-period.util.js';

type EscapeHtml = (value: string) => string;

export function buildWeeklyReportHtmlDocument(
  data: WeeklyReportData,
  fontFaceCss: string,
  escapeHtml: EscapeHtml,
  logoDataUrl: string | null,
): string {
  const { site, period } = data;
  const periodLabel = periodLabelForPdf(period, site.timezone);
  const generatedAt = formatSiteLocalDateTime(new Date(), site.timezone);

  const revenueRows = data.revenue.by_source
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(sourceLabel(row.source))}</td>
        <td class="num">${escapeHtml(formatEurAmount(row.net))}</td>
        <td class="num">${escapeHtml(formatEurAmount(row.vat))}</td>
        <td class="num">${escapeHtml(formatEurAmount(row.gross))}</td>
      </tr>`,
    )
    .join('');

  const groupRows = data.revenue.by_revenue_group
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(row.name)}</td>
        <td class="num">${escapeHtml(formatEurAmount(row.net))}</td>
        <td class="num">${escapeHtml(formatEurAmount(row.vat))}</td>
        <td class="num">${escapeHtml(formatEurAmount(row.gross))}</td>
      </tr>`,
    )
    .join('');

  const openEstimateRows = data.open_estimates
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(row.order_number)}</td>
        <td>${escapeHtml(row.estimate_number)}</td>
        <td>${escapeHtml(formatSiteLocalDate(row.sent_at.slice(0, 10), site.timezone))}</td>
        <td>${escapeHtml(row.valid_until ? formatSiteLocalDate(row.valid_until, site.timezone) : '–')}</td>
        <td class="num">${escapeHtml(formatDecimalString(row.total_gross))}</td>
      </tr>`,
    )
    .join('');

  const completedRows = data.completed_orders
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(row.order_number)}</td>
        <td>${escapeHtml(formatSiteLocalDateTime(new Date(row.completed_at), site.timezone))}</td>
        <td>${escapeHtml(row.vehicle_label)}</td>
      </tr>`,
    )
    .join('');

  const totals = data.workshop_kpis.totals;

  return `<!DOCTYPE html>
<html lang="de-AT">
<head>
  <meta charset="utf-8" />
  <style>
    ${fontFaceCss}
    body { font-family: 'Noto Sans', sans-serif; font-size: 10pt; color: #111; margin: 0; }
    h1 { font-size: 16pt; margin: 0 0 4px; }
    h2 { font-size: 12pt; margin: 18px 0 6px; border-bottom: 1px solid #ccc; padding-bottom: 2px; }
    .meta { color: #444; margin-bottom: 12px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .logo img { max-height: 48px; max-width: 160px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #eee; vertical-align: top; }
    th { font-weight: 600; background: #f7f7f7; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    .kpi-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px 16px; }
    .kpi { padding: 8px; background: #fafafa; border: 1px solid #eee; border-radius: 4px; }
    .kpi strong { display: block; font-size: 11pt; }
    .empty { color: #666; font-style: italic; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Wochenbericht</h1>
      <div class="meta">${escapeHtml(site.name)} · ${escapeHtml(periodLabel)}</div>
      <div class="meta">Erstellt am ${escapeHtml(generatedAt)}</div>
    </div>
    ${logoDataUrl ? `<div class="logo"><img src="${logoDataUrl}" alt="" /></div>` : ''}
  </div>

  <h2>Umsatz</h2>
  <table>
    <thead>
      <tr>
        <th>Quelle</th>
        <th class="num">Netto</th>
        <th class="num">USt</th>
        <th class="num">Brutto</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Gesamt</strong></td>
        <td class="num">${escapeHtml(formatEurAmount(data.revenue.totals.net))}</td>
        <td class="num">${escapeHtml(formatEurAmount(data.revenue.totals.vat))}</td>
        <td class="num">${escapeHtml(formatEurAmount(data.revenue.totals.gross))}</td>
      </tr>
      ${revenueRows}
    </tbody>
  </table>
  <table>
    <thead>
      <tr>
        <th>Umsatzgruppe</th>
        <th class="num">Netto</th>
        <th class="num">USt</th>
        <th class="num">Brutto</th>
      </tr>
    </thead>
    <tbody>${groupRows || `<tr><td colspan="4" class="empty">Keine Umsätze im Zeitraum</td></tr>`}</tbody>
  </table>
  <p class="meta">Rechnungen im Zeitraum: ${data.revenue.invoice_count}</p>

  <h2>Werkstatt-KPIs</h2>
  <div class="kpi-grid">
    <div class="kpi"><span>Auslastung</span><strong>${escapeHtml(formatPercent(totals.utilisation_percent))}</strong></div>
    <div class="kpi"><span>Leistungsgrad</span><strong>${escapeHtml(formatPercent(totals.productivity_percent))}</strong></div>
    <div class="kpi"><span>Ø Netto-Umsatz pro Auftrag</span><strong>${escapeHtml(formatDecimalString(totals.average_net_revenue_per_order))}</strong></div>
    <div class="kpi"><span>Abgeschlossene Aufträge (KPI)</span><strong>${totals.closed_orders}</strong></div>
    <div class="kpi"><span>Teileumschlag</span><strong>${escapeHtml(formatDecimalString(data.workshop_kpis.parts_turnover.turnover))}</strong></div>
  </div>

  <h2>Offene Kostenvoranschläge (KVA)</h2>
  <table>
    <thead>
      <tr>
        <th>Auftrag</th>
        <th>KVA-Nr.</th>
        <th>Gesendet</th>
        <th>Gültig bis</th>
        <th class="num">Brutto</th>
      </tr>
    </thead>
    <tbody>
      ${openEstimateRows || `<tr><td colspan="5" class="empty">Keine offenen KVA-Freigaben</td></tr>`}
    </tbody>
  </table>

  <h2>Abgeschlossene Aufträge in der Woche</h2>
  <table>
    <thead>
      <tr>
        <th>Auftrag</th>
        <th>Abgeschlossen</th>
        <th>Fahrzeug</th>
      </tr>
    </thead>
    <tbody>
      ${completedRows || `<tr><td colspan="3" class="empty">Keine abgeschlossenen Aufträge im Zeitraum</td></tr>`}
    </tbody>
  </table>
</body>
</html>`;
}

function sourceLabel(source: string): string {
  switch (source) {
    case 'workshop':
      return 'Werkstatt';
    case 'vehicle_sales':
      return 'Fahrzeugverkauf';
    case 'other':
      return 'Sonstiges';
    default:
      return source;
  }
}
