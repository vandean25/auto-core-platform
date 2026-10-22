import { extractVisibleTextFromHtml } from '../../common/pdf/pdf-html-text.js';
import { I18N_TRANSLATION_BUNDLE_VERSION } from '../../common/i18n/display-language.js';
import {
  loadPdfLocaleJson,
  pdfLocaleString,
} from '../../common/i18n/pdf-locale-test-helpers.js';
import { buildKaufvertragHtmlDocument } from './kaufvertrag-pdf.layout.js';
import {
  buildKaufvertragSnapshot,
  type KaufvertragSnapshotInput,
} from './kaufvertrag-snapshot.js';

const BASE_INPUT: KaufvertragSnapshotInput = {
  sale: {
    id: '00000000-0000-4000-8000-0000000000a1',
    sale_number: 'VS-2026-0001',
    sale_price_eur: '18500.00',
    contract_concluded_at: new Date('2026-10-02T00:00:00.000Z'),
    handed_over_at: new Date('2026-10-08T00:00:00.000Z'),
  },
  seller: {
    name: 'Demo Autohaus GmbH',
    country_iso: 'AT',
    address_street: 'Musterweg 1',
    address_line2: null,
    address_zip: '1010',
    address_city: 'Wien',
    tax_number: '123/4567',
    vat_id: 'ATU12345678',
    iban: null,
    bic: null,
    bank_name: null,
    email: null,
    phone: null,
    registration_number: 'FN 123456a',
    registration_court: 'Handelsgericht Wien',
    representatives: 'Max Mustermann',
  },
  buyer: {
    type: 'PRIVATE',
    company_name: null,
    first_name: 'Erika',
    last_name: 'Musterfrau',
    vat_id: null,
    address_street: 'Beispielgasse 2',
    address_zip: '4020',
    address_city: 'Linz',
    address_country: 'AT',
  },
  vehicle: {
    make: 'Demo',
    model: 'Compact 1.0',
    vin: 'DEMOVIN0000000001',
    hsn: '1234',
    tsn: 'ABC',
    color: 'Grau',
    mileage: 84500,
    first_registration_date: new Date('2020-10-08T00:00:00.000Z'),
  },
  warranty: {
    regime: 'CONSUMER_BASE',
    contractConcludedAt: new Date('2026-10-02T00:00:00.000Z'),
    handedOverAt: new Date('2026-10-08T00:00:00.000Z'),
    buyerIsConsumer: true,
    basePeriodYears: 2,
    presumptionPeriodYears: 1,
    baseEndsOn: new Date('2028-10-08T00:00:00.000Z'),
    presumptionEndsOn: new Date('2027-10-08T00:00:00.000Z'),
    ruleVersion: 'at-used-vehicle-vgg-2026-10-v2',
  },
  garantie: null,
  branding: {
    schema_version: 1,
    profile_id: null,
    profile_revision: 0,
    preset_id: 'standard-v1',
    font_id: 'acp-sans-v1',
    tokens: {
      primary_color: '#1d4ed8',
      secondary_color: '#0f172a',
      header_band: 'none',
      footer_band: 'none',
      header_text: 'Demo Autohaus',
      footer_text: 'Demo Autohaus GmbH',
    },
    logo: null,
    resolved_at: '2026-10-09T08:00:00.000Z',
  },
};

describe('kaufvertrag-pdf.layout golden text', () => {
  const dePdf = loadPdfLocaleJson('de');
  const enPdf = loadPdfLocaleJson('en');

  it('renders the German contract title from pdf.json by default', () => {
    const snapshot = buildKaufvertragSnapshot(BASE_INPUT);
    const text = extractVisibleTextFromHtml(
      buildKaufvertragHtmlDocument(snapshot, { fontFaceCss: '' }),
    );
    expect(text).toContain(pdfLocaleString(dePdf, 'kaufvertrag.titleFull'));
    expect(text).toContain(pdfLocaleString(dePdf, 'kaufvertrag.sellerHeading'));
    expect(text).toContain(pdfLocaleString(dePdf, 'kaufvertrag.makeModelLabel'));
  });

  it('renders English presentation labels from pdf.json when document_locale is en', () => {
    const snapshot = {
      ...buildKaufvertragSnapshot({ ...BASE_INPUT, documentLocale: 'en' }),
      document_locale: 'en' as const,
      format_locale: 'de-AT' as const,
      translation_bundle_version: I18N_TRANSLATION_BUNDLE_VERSION,
      legal_text_version: null,
    };
    const text = extractVisibleTextFromHtml(
      buildKaufvertragHtmlDocument(snapshot, { fontFaceCss: '' }),
    );
    expect(text).toContain(pdfLocaleString(enPdf, 'kaufvertrag.titleFull'));
    expect(text).toContain(pdfLocaleString(enPdf, 'kaufvertrag.sellerHeading'));
    expect(text).toContain(pdfLocaleString(enPdf, 'kaufvertrag.buyerHeading'));
    expect(text).toContain(pdfLocaleString(enPdf, 'kaufvertrag.makeModelLabel'));
    expect(text).toContain(pdfLocaleString(enPdf, 'legal.authoritativeGermanNotice'));
    expect(text).toContain('Gewährleistung');
  });
});
