import type { TFunction } from 'i18next';
import {
  buildPdfFooterPageNumbersHtml,
  escapeHtml,
} from '../../common/pdf/pdf-layout.js';
import { buildAuthoritativeGermanLegalNoticeHtml } from '../../common/i18n/pdf-legal-notice.js';
import { resolveDocumentLanguage } from '../../common/i18n/locale-resolution.js';
import { createPdfTranslator } from '../../common/i18n/pdf-i18n.js';
import { snapshotUsesLocalizedPdfResources } from '../../common/i18n/pdf-resource-bundle.js';
import type { KaufvertragSnapshot } from './kaufvertrag-snapshot.js';

const DEFAULT_PRIMARY = '#1d4ed8';
const DEFAULT_SECONDARY = '#0f172a';
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

type KaufvertragLayoutOptions = {
  fontFaceCss: string;
};

/** `YYYY-MM-DD` to `DD.MM.YYYY`. */
export function formatDeDay(isoDay: string): string {
  const [year, month, day] = isoDay.split('-');
  return `${day}.${month}.${year}`;
}

/** Purchase price in German notation, for example `18.500,00 €`. */
export function formatDeEuro(amount: string): string {
  const formatted = new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount));
  return `${formatted} €`;
}

function safeColor(value: string, fallback: string): string {
  return HEX_COLOR.test(value) ? value : fallback;
}

function sellerLines(
  snapshot: KaufvertragSnapshot,
  t: TFunction | null,
): string {
  const { seller } = snapshot;
  const street = [seller.address_street, seller.address_line2]
    .filter(Boolean)
    .join(', ');
  const cityLine = [seller.address_zip, seller.address_city]
    .filter(Boolean)
    .join(' ');
  const vatLine = seller.vat_id
    ? t
      ? escapeHtml(t('kaufvertrag.uidLine', { value: seller.vat_id }))
      : `UID: ${escapeHtml(seller.vat_id)}`
    : '';
  const taxLine = seller.tax_number
    ? t
      ? escapeHtml(t('kaufvertrag.taxNumberLine', { value: seller.tax_number }))
      : `Steuernummer: ${escapeHtml(seller.tax_number)}`
    : '';
  const registrationLine = seller.registration_number
    ? t
      ? escapeHtml(
          t('kaufvertrag.companyBookNumberLine', {
            value: seller.registration_number,
          }),
        )
      : `Firmenbuchnummer: ${escapeHtml(seller.registration_number)}`
    : '';
  const courtLine = seller.registration_court
    ? t
      ? escapeHtml(
          t('kaufvertrag.companyBookCourtLine', {
            value: seller.registration_court,
          }),
        )
      : `Firmenbuchgericht: ${escapeHtml(seller.registration_court)}`
    : '';
  const representativesLine = seller.representatives
    ? t
      ? escapeHtml(
          t('kaufvertrag.representedByLine', { value: seller.representatives }),
        )
      : `Vertreten durch: ${escapeHtml(seller.representatives)}`
    : '';
  return [
    `<strong>${escapeHtml(seller.name)}</strong>`,
    escapeHtml(street),
    escapeHtml(cityLine),
    vatLine,
    taxLine,
    registrationLine,
    courtLine,
    representativesLine,
  ]
    .filter(Boolean)
    .join('<br>');
}

function buyerLines(
  snapshot: KaufvertragSnapshot,
  t: TFunction | null,
): string {
  const { buyer } = snapshot;
  const name =
    buyer.type === 'COMPANY' && buyer.company_name
      ? buyer.company_name
      : `${buyer.first_name} ${buyer.last_name}`.trim();
  const country =
    buyer.address_country && buyer.address_country !== 'AT'
      ? buyer.address_country
      : '';
  const cityLine = [buyer.address_zip, buyer.address_city]
    .filter(Boolean)
    .join(' ');
  const buyerStatus =
    snapshot.warranty.regime === 'B2B_PER_CONTRACT'
      ? t
        ? t('kaufvertrag.buyerBusinessCustomer')
        : 'Unternehmer'
      : t
        ? t('kaufvertrag.buyerConsumer')
        : 'Verbraucher';
  const buyerVatLine = buyer.vat_id
    ? t
      ? escapeHtml(t('kaufvertrag.uidLine', { value: buyer.vat_id }))
      : `UID: ${escapeHtml(buyer.vat_id)}`
    : '';
  return [
    `<strong>${escapeHtml(name)}</strong>`,
    escapeHtml(buyer.address_street ?? ''),
    escapeHtml(cityLine),
    escapeHtml(country),
    buyerVatLine,
    buyerStatus,
  ]
    .filter(Boolean)
    .join('<br>');
}

function warrantySection(snapshot: KaufvertragSnapshot): string {
  const { warranty } = snapshot;
  if (warranty.regime === 'B2B_PER_CONTRACT') {
    return `
      <section class="warranty">
        <h2>Gewährleistung</h2>
        <p>Unternehmergeschäft: Die Gewährleistung richtet sich nach dem Vertrag.</p>
      </section>`;
  }

  const wording =
    warranty.regime === 'CONSUMER_SHORTENED'
      ? 'Verbrauchergeschäft: Die Gewährleistungsfrist wurde individuell auf ein Jahr ab Übergabe verkürzt. Die Erstzulassung liegt mehr als ein Jahr vor der Übergabe.'
      : 'Verbrauchergeschäft: Es gilt die gesetzliche Gewährleistungsfrist: zwei Jahre ab Übergabe.';
  const endsOn = warranty.base_ends_on
    ? formatDeDay(warranty.base_ends_on)
    : '–';
  const presumption = warranty.presumption_ends_on
    ? `
        <aside class="research-note">
          <strong>Hinweis zur Vermutungsfrist (Rechercheangabe, keine Rechtsberatung):</strong>
          Zeigt sich innerhalb eines Jahres ab Übergabe ein Mangel, wird vermutet, dass er bereits bei Übergabe vorlag.
          Vermutungsfrist bis ${formatDeDay(warranty.presumption_ends_on)}.
        </aside>`
    : '';

  return `
      <section class="warranty">
        <h2>Gewährleistung (gesetzlich)</h2>
        <p>${wording}</p>
        <p>Das Ende der Gewährleistungsfrist ist der ${endsOn}.</p>
        ${presumption}
      </section>`;
}

function garantieSection(snapshot: KaufvertragSnapshot): string {
  const { garantie } = snapshot;
  if (!garantie) return '';
  return `
      <section class="garantie">
        <h2>Freiwillige Garantie</h2>
        <p class="garantie-label">Zusätzliche freiwillige Zusage des Verkäufers, nicht Teil der gesetzlichen Gewährleistung.</p>
        <p>Dauer: ${garantie.duration_months} Monate ab Übergabe</p>
        ${garantie.terms ? `<p class="garantie-terms">${escapeHtml(garantie.terms)}</p>` : ''}
      </section>`;
}

export function buildKaufvertragHtmlDocument(
  snapshot: KaufvertragSnapshot,
  options: KaufvertragLayoutOptions,
): string {
  const { vehicle, sale } = snapshot;
  const primary = safeColor(
    snapshot.branding.tokens.primary_color,
    DEFAULT_PRIMARY,
  );
  const secondary = safeColor(
    snapshot.branding.tokens.secondary_color,
    DEFAULT_SECONDARY,
  );
  const registration = vehicle.first_registration_date
    ? formatDeDay(vehicle.first_registration_date)
    : '–';
  const mileage =
    vehicle.mileage !== null
      ? `${vehicle.mileage.toLocaleString('de-DE')} km`
      : '–';
  const typeCodes =
    [vehicle.hsn, vehicle.tsn].filter(Boolean).join(' / ') || '–';
  const documentLocale = resolveDocumentLanguage(snapshot);
  const t = snapshotUsesLocalizedPdfResources(snapshot)
    ? createPdfTranslator(documentLocale)
    : null;
  const legalNotice = t
    ? buildAuthoritativeGermanLegalNoticeHtml(documentLocale)
    : '';
  const title = t
    ? t('kaufvertrag.titleFull')
    : 'Kaufvertrag über ein gebrauchtes Kraftfahrzeug';
  const htmlLang = t ? t('kaufvertrag.htmlLang') : 'de-AT';
  const contractNumberLabel = t
    ? t('kaufvertrag.contractNumberLabel')
    : 'Vertragsnummer';
  const contractDateLabel = t
    ? t('kaufvertrag.contractDateLabel')
    : 'Vertragsdatum';
  const handoverLabel = t ? t('kaufvertrag.handoverLabel') : 'Übergabe';
  const sellerHeading = t ? t('kaufvertrag.sellerHeading') : 'Verkäufer';
  const buyerHeading = t ? t('kaufvertrag.buyerHeading') : 'Käufer';
  const vehicleHeading = t ? t('kaufvertrag.vehicleHeading') : 'Fahrzeug';
  const makeModelLabel = t ? t('kaufvertrag.makeModelLabel') : 'Marke / Modell';
  const vinLabel = t ? t('kaufvertrag.vinLabel') : 'Fahrgestellnummer (FIN)';
  const hsnTsnLabel = t ? t('kaufvertrag.hsnTsnLabel') : 'HSN / TSN';
  const firstRegistrationLabel = t
    ? t('kaufvertrag.firstRegistrationLabel')
    : 'Erstzulassung';
  const mileageLabel = t ? t('kaufvertrag.mileageLabel') : 'Kilometerstand';
  const colorLabel = t ? t('kaufvertrag.colorLabel') : 'Farbe';
  const purchasePriceLabel = t
    ? t('kaufvertrag.purchasePriceGrossLabel')
    : 'Kaufpreis (brutto)';
  const signatureSeller = t ? t('kaufvertrag.signatureSeller') : 'Verkäufer';
  const signatureBuyer = t ? t('kaufvertrag.signatureBuyer') : 'Käufer';

  return `<!doctype html>
<html lang="${htmlLang}">
<head>
  <meta charset="utf-8">
  <style>
    ${options.fontFaceCss}
    :root { --primary: ${primary}; --secondary: ${secondary}; }
    body { font-family: 'ACP Sans', 'Noto Sans', sans-serif; color: #0f172a; font-size: 10pt; line-height: 1.45; margin: 0; }
    h1 { font-size: 16pt; margin: 0 0 4px; color: var(--primary); }
    h2 { font-size: 11pt; margin: 0 0 6px; color: var(--primary); border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; }
    .meta { color: #475569; margin: 0 0 12px; }
    .parties { display: flex; gap: 16px; }
    .parties > div { flex: 1; }
    section, .research-note, .garantie, .signatures { break-inside: avoid; }
    section { margin-top: 12px; }
    table.vehicle { width: 100%; border-collapse: collapse; }
    table.vehicle td { padding: 2px 4px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    table.vehicle td.k { color: #475569; width: 32%; }
    .price { font-weight: 700; }
    .research-note { margin-top: 8px; padding: 8px 10px; border-left: 3px solid #94a3b8; background: #f1f5f9; font-size: 9pt; }
    .garantie { margin-top: 12px; padding: 8px 12px; border: 1.5px dashed var(--secondary); border-radius: 4px; background: #f8fafc; }
    .garantie h2 { border-bottom: none; color: var(--secondary); }
    .garantie-label { font-style: italic; color: #475569; margin: 0 0 4px; }
    .garantie-terms { white-space: pre-line; margin: 6px 0 0; }
    .signatures { display: flex; justify-content: space-between; margin-top: 28px; }
    .signature { width: 42%; border-top: 1px solid #0f172a; padding-top: 4px; }
  </style>
</head>
<body>
  ${legalNotice}
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">
    ${escapeHtml(contractNumberLabel)} ${escapeHtml(sale.sale_number)} · ${escapeHtml(contractDateLabel)} ${formatDeDay(sale.contract_concluded_at)} · ${escapeHtml(handoverLabel)} ${formatDeDay(sale.handed_over_at)}
  </p>

  <div class="parties">
    <div>
      <h2>${escapeHtml(sellerHeading)}</h2>
      <p>${sellerLines(snapshot, t)}</p>
    </div>
    <div>
      <h2>${escapeHtml(buyerHeading)}</h2>
      <p>${buyerLines(snapshot, t)}</p>
    </div>
  </div>

  <section>
    <h2>${escapeHtml(vehicleHeading)}</h2>
    <table class="vehicle">
      <tr><td class="k">${escapeHtml(makeModelLabel)}</td><td>${escapeHtml(vehicle.make)} ${escapeHtml(vehicle.model)}</td></tr>
      <tr><td class="k">${escapeHtml(vinLabel)}</td><td>${escapeHtml(vehicle.vin)}</td></tr>
      <tr><td class="k">${escapeHtml(hsnTsnLabel)}</td><td>${escapeHtml(typeCodes)}</td></tr>
      <tr><td class="k">${escapeHtml(firstRegistrationLabel)}</td><td>${registration}</td></tr>
      <tr><td class="k">${escapeHtml(mileageLabel)}</td><td>${mileage}</td></tr>
      <tr><td class="k">${escapeHtml(colorLabel)}</td><td>${escapeHtml(vehicle.color ?? '–')}</td></tr>
      <tr><td class="k">${escapeHtml(purchasePriceLabel)}</td><td class="price">${formatDeEuro(sale.sale_price_eur)}</td></tr>
    </table>
  </section>

  ${warrantySection(snapshot)}
  ${garantieSection(snapshot)}

  <div class="signatures">
    <div class="signature">${escapeHtml(signatureSeller)}</div>
    <div class="signature">${escapeHtml(signatureBuyer)}</div>
  </div>
</body>
</html>`;
}

export function buildKaufvertragHeaderTemplate(
  snapshot: KaufvertragSnapshot,
  logoDataUrl: string | null,
  fontFaceCss: string,
): string {
  const logo = logoDataUrl
    ? `<img src="${escapeHtml(logoDataUrl)}" style="max-height:28px;">`
    : '';
  return `<style>${fontFaceCss}</style>
<div style="font-family:'ACP Sans','Noto Sans',sans-serif;font-size:8pt;color:#475569;width:100%;padding:0 16mm;display:flex;justify-content:space-between;align-items:center;">
  <span>${logo}</span>
  <span>${escapeHtml(snapshot.seller.name)}</span>
</div>`;
}

export function buildKaufvertragFooterTemplate(
  snapshot: KaufvertragSnapshot,
  fontFaceCss: string,
): string {
  return `<style>${fontFaceCss}</style>
<div style="font-family:'ACP Sans','Noto Sans',sans-serif;font-size:8pt;color:#475569;width:100%;padding:0 16mm;display:flex;justify-content:space-between;">
  <span>${escapeHtml(snapshot.seller.name)} · Vertrag ${escapeHtml(snapshot.sale.sale_number)}</span>
  <span>${buildPdfFooterPageNumbersHtml(resolveDocumentLanguage(snapshot))}</span>
</div>`;
}
