import type { WorkshopLineItemType } from '@prisma/client';
import { escapeHtml } from '../common/pdf/pdf-layout.js';
import type { WarrantyClaimResponse } from './warranty-claim.mapper.js';

const DEFAULT_PRIMARY = '#1d4ed8';
const DEFAULT_SECONDARY = '#0f172a';
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const TYPE_TITLES: Record<WarrantyClaimResponse['type'], string> = {
  GARANTIE: 'Garantieantrag',
  KULANZ: 'Kulanzantrag',
  GEWAEHRLEISTUNG: 'Gewährleistungsantrag',
};

const STATUS_LABELS: Record<WarrantyClaimResponse['status'], string> = {
  DRAFT: 'Entwurf',
  SUBMITTED_EXTERNALLY: 'Beim Hersteller eingereicht',
  APPROVED: 'Genehmigt',
  REJECTED: 'Abgelehnt',
  CLOSED: 'Abgeschlossen',
};

const LINE_TYPE_LABELS: Record<WorkshopLineItemType, string> = {
  LABOR: 'Arbeit',
  PART: 'Teil',
};

export type WarrantyClaimPdfContent = {
  claim: WarrantyClaimResponse;
  order: {
    orderNumber: string;
    odometer: number | null;
    vehicle: {
      make: string;
      model: string;
      vin: string | null;
      plate: string | null;
    };
  };
  seller: { name: string; addressLines: string[]; vatId: string | null };
  tokens: { primaryColor: string; secondaryColor: string };
  logoDataUrl: string | null;
  generatedAt: Date;
};

type LayoutOptions = {
  fontFaceCss: string;
};

function safeColor(value: string, fallback: string): string {
  return HEX_COLOR.test(value) ? value : fallback;
}

/** `YYYY-MM-DD` to `DD.MM.YYYY`. */
export function formatDeDay(isoDay: string): string {
  const [year, month, day] = isoDay.split('-');
  return `${day}.${month}.${year}`;
}

/** Amount in EUR with German notation, for example `1.250,00 €`. */
export function formatDeEuro(amount: string): string {
  const formatted = new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount));
  return `${formatted} €`;
}

function formatDeDateTime(value: Date): string {
  return new Intl.DateTimeFormat('de-AT', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Vienna',
  }).format(value);
}

function formatTimestamp(iso: string | null): string {
  return iso ? formatDeDateTime(new Date(iso)) : '–';
}

function formatDay(isoDay: string | null): string {
  return isoDay ? formatDeDay(isoDay) : '–';
}

function formatQuantity(value: string): string {
  return Number(value).toLocaleString('de-DE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function formatOdometer(value: number | null): string {
  return value === null ? '–' : `${value.toLocaleString('de-DE')} km`;
}

function linesTable(content: WarrantyClaimPdfContent): string {
  const { claim } = content;
  if (claim.lines.length === 0) {
    return '<p class="muted">Keine Positionen zugeordnet.</p>';
  }

  const rows = claim.lines
    .map(
      (line) => `
        <tr>
          <td>${escapeHtml(LINE_TYPE_LABELS[line.lineType])}</td>
          <td>${escapeHtml(line.itemNo)}</td>
          <td>${escapeHtml(line.description)}</td>
          <td class="num">${escapeHtml(formatQuantity(line.quantity))}</td>
          <td class="num">${escapeHtml(formatDeEuro(line.unitPrice))}</td>
          <td class="num">${escapeHtml(formatDeEuro(line.netAmount))}</td>
        </tr>`,
    )
    .join('');

  return `
      <table class="lines">
        <thead>
          <tr>
            <th>Art</th>
            <th>Nummer</th>
            <th>Bezeichnung</th>
            <th class="num">Menge</th>
            <th class="num">Einzelpreis</th>
            <th class="num">Netto</th>
          </tr>
        </thead>
        <tbody>${rows}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="5">Summe der Positionen (netto)</td>
            <td class="num">${escapeHtml(formatDeEuro(claim.linesNetAmount))}</td>
          </tr>
        </tfoot>
      </table>`;
}

function textBlock(value: string | null): string {
  return value
    ? `<div class="text">${escapeHtml(value)}</div>`
    : '<p class="muted">–</p>';
}

export function buildWarrantyClaimHtml(
  content: WarrantyClaimPdfContent,
  options: LayoutOptions,
): string {
  const { claim, order, seller, tokens } = content;
  const primary = safeColor(tokens.primaryColor, DEFAULT_PRIMARY);
  const secondary = safeColor(tokens.secondaryColor, DEFAULT_SECONDARY);
  const vehicleName = `${order.vehicle.make} ${order.vehicle.model}`.trim();

  return `<!doctype html>
<html lang="de-AT">
<head>
  <meta charset="utf-8">
  <style>
    ${options.fontFaceCss}
    :root { --primary: ${primary}; --secondary: ${secondary}; }
    body { font-family: 'ACP Sans', 'Noto Sans', sans-serif; color: #0f172a; font-size: 10pt; line-height: 1.45; margin: 0; }
    h1 { font-size: 16pt; margin: 0 0 4px; color: var(--primary); }
    h2 { font-size: 11pt; margin: 0 0 6px; color: var(--primary); border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; }
    .meta { color: #475569; margin: 0 0 12px; }
    .muted { color: #64748b; }
    section { margin-top: 12px; break-inside: avoid; }
    table { width: 100%; border-collapse: collapse; }
    table.facts td { padding: 2px 4px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    table.facts td.k { color: #475569; width: 32%; }
    table.lines th, table.lines td { padding: 4px; border-bottom: 1px solid #e2e8f0; vertical-align: top; text-align: left; }
    table.lines th { color: #475569; font-weight: 600; border-bottom: 1px solid #94a3b8; }
    table.lines tfoot td { font-weight: 700; border-top: 1px solid #94a3b8; border-bottom: none; }
    .num { text-align: right; white-space: nowrap; }
    .text { white-space: pre-line; }
    .parties { display: flex; gap: 16px; }
    .parties > div { flex: 1; }
    .amount { font-weight: 700; color: var(--secondary); }
  </style>
</head>
<body>
  <h1>${escapeHtml(TYPE_TITLES[claim.type])}</h1>
  <p class="meta">
    Auftrag ${escapeHtml(order.orderNumber)} · Status: ${escapeHtml(STATUS_LABELS[claim.status])} · Stand ${escapeHtml(formatDeDateTime(content.generatedAt))}
  </p>

  <div class="parties">
    <section>
      <h2>Fahrzeug</h2>
      <table class="facts">
        <tr><td class="k">Marke / Modell</td><td>${escapeHtml(vehicleName)}</td></tr>
        <tr><td class="k">Fahrgestellnummer (FIN)</td><td>${escapeHtml(order.vehicle.vin ?? '–')}</td></tr>
        <tr><td class="k">Kennzeichen</td><td>${escapeHtml(order.vehicle.plate ?? '–')}</td></tr>
        <tr><td class="k">Kilometerstand bei Annahme</td><td>${escapeHtml(formatOdometer(order.odometer))}</td></tr>
      </table>
    </section>
    <section>
      <h2>Werkstatt</h2>
      <p><strong>${escapeHtml(seller.name)}</strong><br>
        ${seller.addressLines.map((line) => escapeHtml(line)).join('<br>')}
        ${seller.vatId ? `<br>UID: ${escapeHtml(seller.vatId)}` : ''}
      </p>
    </section>
  </div>

  <section>
    <h2>Reklamation</h2>
    ${textBlock(claim.complaint)}
  </section>

  <section>
    <h2>Ursache und Abhilfe</h2>
    ${textBlock(claim.causeCorrection)}
  </section>

  <section>
    <h2>Betroffene Positionen</h2>
    ${linesTable(content)}
  </section>

  <section>
    <h2>Antrag</h2>
    <table class="facts">
      <tr><td class="k">Beantragter Betrag (netto)</td><td class="amount">${escapeHtml(claim.claimedAmountNet ? formatDeEuro(claim.claimedAmountNet) : '–')}</td></tr>
      <tr><td class="k">Referenz beim Hersteller</td><td>${escapeHtml(claim.externalReference ?? '–')}</td></tr>
      <tr><td class="k">Eingereicht am</td><td>${escapeHtml(formatTimestamp(claim.submittedAt))}</td></tr>
      <tr><td class="k">Entscheidung am</td><td>${escapeHtml(formatDay(claim.decisionDate))}</td></tr>
      <tr><td class="k">Entscheidungsnotiz</td><td>${claim.decisionNote ? `<span class="text">${escapeHtml(claim.decisionNote)}</span>` : '–'}</td></tr>
      <tr><td class="k">Abgeschlossen am</td><td>${escapeHtml(formatTimestamp(claim.closedAt))}</td></tr>
    </table>
  </section>
</body>
</html>`;
}

export function buildWarrantyClaimHeaderTemplate(
  content: WarrantyClaimPdfContent,
  fontFaceCss: string,
): string {
  const logo = content.logoDataUrl
    ? `<img src="${escapeHtml(content.logoDataUrl)}" style="max-height:28px;">`
    : '';
  return `<style>${fontFaceCss}</style>
<div style="font-family:'ACP Sans','Noto Sans',sans-serif;font-size:8pt;color:#475569;width:100%;padding:0 16mm;display:flex;justify-content:space-between;align-items:center;">
  <span>${logo}</span>
  <span>${escapeHtml(content.seller.name)}</span>
</div>`;
}

export function buildWarrantyClaimFooterTemplate(
  content: WarrantyClaimPdfContent,
  fontFaceCss: string,
): string {
  return `<style>${fontFaceCss}</style>
<div style="font-family:'ACP Sans','Noto Sans',sans-serif;font-size:8pt;color:#475569;width:100%;padding:0 16mm;display:flex;justify-content:space-between;">
  <span>${escapeHtml(content.seller.name)} · Auftrag ${escapeHtml(content.order.orderNumber)}</span>
  <span>Seite <span class="pageNumber"></span> von <span class="totalPages"></span></span>
</div>`;
}
