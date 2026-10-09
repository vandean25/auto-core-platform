import {
  buildKaufvertragFooterTemplate,
  buildKaufvertragHeaderTemplate,
  buildKaufvertragHtmlDocument,
} from './kaufvertrag-pdf.layout.js';
import {
  buildKaufvertragSnapshot,
  type KaufvertragSnapshot,
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

function snapshotWith(
  overrides: Partial<KaufvertragSnapshotInput>,
): KaufvertragSnapshot {
  return buildKaufvertragSnapshot({ ...BASE_INPUT, ...overrides });
}

function render(snapshot: KaufvertragSnapshot) {
  return buildKaufvertragHtmlDocument(snapshot, { fontFaceCss: '' });
}

describe('buildKaufvertragHtmlDocument', () => {
  it('states the two-year period and its computed end date for a consumer', () => {
    const html = render(snapshotWith({}));

    expect(html).toContain('zwei Jahre ab Übergabe');
    expect(html).toContain('Das Ende der Gewährleistungsfrist ist der 08.10.2028.');
  });

  it('states the negotiated one-year period when it applies', () => {
    const html = render(
      snapshotWith({
        warranty: {
          ...BASE_INPUT.warranty,
          regime: 'CONSUMER_SHORTENED',
          basePeriodYears: 1,
          baseEndsOn: new Date('2027-10-08T00:00:00.000Z'),
        },
      }),
    );

    expect(html).toContain('individuell auf ein Jahr ab Übergabe verkürzt');
    expect(html).toContain('Das Ende der Gewährleistungsfrist ist der 08.10.2027.');
    expect(html).not.toContain('zwei Jahre ab Übergabe');
  });

  it('states per-contract wording without an end date for a B2B buyer', () => {
    const html = render(
      snapshotWith({
        buyer: { ...BASE_INPUT.buyer, type: 'COMPANY', company_name: 'Beispiel GmbH' },
        warranty: {
          ...BASE_INPUT.warranty,
          regime: 'B2B_PER_CONTRACT',
          buyerIsConsumer: false,
          basePeriodYears: null,
          presumptionPeriodYears: null,
          baseEndsOn: null,
          presumptionEndsOn: null,
        },
      }),
    );

    expect(html).toContain('Die Gewährleistung richtet sich nach dem Vertrag.');
    expect(html).not.toContain('Gewährleistungsfrist ist der');
    expect(html).not.toContain('Vermutungsfrist');
  });

  it('prints the presumption as a research note that is not legal advice for consumers', () => {
    const html = render(snapshotWith({}));

    expect(html).toContain('Rechercheangabe');
    expect(html).toContain('keine Rechtsberatung');
    expect(html).toContain('Vermutungsfrist bis 08.10.2027');
  });

  it('renders the Garantie block in its own labelled section only when configured', () => {
    const withGarantie = render(
      snapshotWith({ garantie: { months: 12, terms: 'Motorschaden ausgenommen' } }),
    );
    expect(withGarantie).toContain('class="garantie"');
    expect(withGarantie).toContain('Freiwillige Garantie');
    expect(withGarantie).toContain('Dauer: 12 Monate ab Übergabe');
    expect(withGarantie).toContain('Motorschaden ausgenommen');

    const withoutGarantie = render(snapshotWith({ garantie: null }));
    expect(withoutGarantie).not.toContain('class="garantie"');
    expect(withoutGarantie).not.toContain('Freiwillige Garantie');
  });

  it('escapes user-provided Garantie terms', () => {
    const html = render(
      snapshotWith({
        garantie: { months: 6, terms: '<script>alert("x")</script>' },
      }),
    );

    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert');
  });

  it('shows the vehicle identity and seller tax identifiers', () => {
    const html = render(snapshotWith({}));

    expect(html).toContain('DEMOVIN0000000001');
    expect(html).toContain('ATU12345678');
    expect(html).toContain('FN 123456a');
    expect(html).toContain('08.10.2020');
  });

  it('formats the purchase price in German notation', () => {
    expect(render(snapshotWith({}))).toMatch(/18\.500,00\s?€/);
  });

  it('uses the brand primary colour only when it is a six-digit hex colour', () => {
    const valid = render(snapshotWith({}));
    expect(valid).toContain('--primary: #1d4ed8');

    const invalid = render(
      snapshotWith({
        branding: {
          ...BASE_INPUT.branding,
          tokens: {
            ...BASE_INPUT.branding.tokens,
            primary_color: 'red; } body { display: none',
          },
        },
      }),
    );
    expect(invalid).not.toContain('display: none');
    expect(invalid).toContain('--primary: #1d4ed8');
  });

  it('keeps the logo in the running header rather than the document body', () => {
    expect(render(snapshotWith({}))).not.toContain('<img');
    expect(
      buildKaufvertragHeaderTemplate(snapshotWith({}), 'data:image/png;base64,AAAA', ''),
    ).toContain('src="data:image/png;base64,AAAA"');
  });
});

describe('Kaufvertrag header and footer templates', () => {
  it('shows the sale number and page placeholders in the footer', () => {
    const footer = buildKaufvertragFooterTemplate(snapshotWith({}), '');

    expect(footer).toContain('VS-2026-0001');
    expect(footer).toContain('class="pageNumber"');
    expect(footer).toContain('class="totalPages"');
  });

  it('shows the seller name in the header and embeds the logo when present', () => {
    const header = buildKaufvertragHeaderTemplate(
      snapshotWith({}),
      'data:image/png;base64,AAAA',
      '',
    );

    expect(header).toContain('Demo Autohaus');
    expect(header).toContain('data:image/png;base64,AAAA');
  });
});
