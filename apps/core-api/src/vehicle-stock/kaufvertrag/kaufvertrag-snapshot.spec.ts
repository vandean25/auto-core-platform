import type { InvoiceSnapshotV2Seller } from '../../invoices/invoice-snapshot-v2.js';
import type { KaufvertragGewaehrleistung } from './kaufvertrag-facts.js';
import {
  buildKaufvertragArchiveIdentity,
  buildKaufvertragArchiveKey,
  buildKaufvertragSnapshot,
  hashKaufvertragSnapshot,
  KAUFVERTRAG_TEMPLATE_VERSION,
  type KaufvertragSnapshotBranding,
  type KaufvertragSnapshotInput,
} from './kaufvertrag-snapshot.js';

const SELLER: InvoiceSnapshotV2Seller = {
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
};

const BRANDING: KaufvertragSnapshotBranding = {
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
};

const WARRANTY: KaufvertragGewaehrleistung = {
  regime: 'CONSUMER_BASE',
  buyerIsConsumer: true,
  basePeriodYears: 2,
  presumptionPeriodYears: 1,
  baseEndsOn: new Date('2028-10-08T00:00:00.000Z'),
  presumptionEndsOn: new Date('2027-10-08T00:00:00.000Z'),
  ruleVersion: 'at-used-vehicle-vgg-2026-10-v2',
};

function input(
  overrides: Partial<KaufvertragSnapshotInput> = {},
): KaufvertragSnapshotInput {
  return {
    sale: {
      id: '00000000-0000-4000-8000-0000000000a1',
      sale_number: 'VS-2026-0001',
      sale_price_eur: '18500.00',
      contract_concluded_at: new Date('2026-10-02T00:00:00.000Z'),
      handed_over_at: new Date('2026-10-08T00:00:00.000Z'),
    },
    seller: SELLER,
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
    warranty: WARRANTY,
    garantie: null,
    branding: BRANDING,
    ...overrides,
  };
}

describe('buildKaufvertragSnapshot', () => {
  it('stores calendar dates as UTC day strings and the price as a string', () => {
    const snapshot = buildKaufvertragSnapshot(input());

    expect(snapshot.sale).toEqual({
      id: '00000000-0000-4000-8000-0000000000a1',
      sale_number: 'VS-2026-0001',
      sale_price_eur: '18500.00',
      contract_concluded_at: '2026-10-02',
      handed_over_at: '2026-10-08',
    });
    expect(snapshot.vehicle.first_registration_date).toBe('2020-10-08');
    expect(snapshot.warranty).toEqual({
      regime: 'CONSUMER_BASE',
      buyer_is_consumer: true,
      base_period_years: 2,
      presumption_period_years: 1,
      base_ends_on: '2028-10-08',
      presumption_ends_on: '2027-10-08',
      rule_version: 'at-used-vehicle-vgg-2026-10-v2',
    });
  });

  it('stamps the template version and omits the Garantie block when not configured', () => {
    const snapshot = buildKaufvertragSnapshot(input());

    expect(snapshot.template_version).toBe(KAUFVERTRAG_TEMPLATE_VERSION);
    expect(snapshot.schema_version).toBe(1);
    expect(snapshot.garantie).toBeNull();
  });

  it('stores the Garantie duration and terms when configured', () => {
    const snapshot = buildKaufvertragSnapshot(
      input({ garantie: { months: 12, terms: 'Motorschaden ausgenommen' } }),
    );

    expect(snapshot.garantie).toEqual({
      duration_months: 12,
      terms: 'Motorschaden ausgenommen',
    });
  });

  it('stores B2B facts without computed dates', () => {
    const snapshot = buildKaufvertragSnapshot(
      input({
        warranty: {
          ...WARRANTY,
          regime: 'B2B_PER_CONTRACT',
          buyerIsConsumer: false,
          basePeriodYears: null,
          presumptionPeriodYears: null,
          baseEndsOn: null,
          presumptionEndsOn: null,
        },
      }),
    );

    expect(snapshot.warranty).toMatchObject({
      regime: 'B2B_PER_CONTRACT',
      base_ends_on: null,
      presumption_ends_on: null,
    });
  });
});

describe('hashKaufvertragSnapshot', () => {
  it('is stable when only the branding resolution timestamp changes', () => {
    const first = buildKaufvertragSnapshot(input());
    const second = buildKaufvertragSnapshot(
      input({
        branding: { ...BRANDING, resolved_at: '2026-12-31T23:59:59.000Z' },
      }),
    );

    expect(hashKaufvertragSnapshot(second)).toBe(hashKaufvertragSnapshot(first));
  });

  it('changes when the Garantie terms change', () => {
    const base = buildKaufvertragSnapshot(
      input({ garantie: { months: 12, terms: 'A' } }),
    );
    const changed = buildKaufvertragSnapshot(
      input({ garantie: { months: 12, terms: 'B' } }),
    );

    expect(hashKaufvertragSnapshot(changed)).not.toBe(
      hashKaufvertragSnapshot(base),
    );
  });

  it('changes when the Gewährleistung end date changes', () => {
    const base = buildKaufvertragSnapshot(input());
    const changed = buildKaufvertragSnapshot(
      input({
        warranty: { ...WARRANTY, baseEndsOn: new Date('2028-10-07T00:00:00.000Z') },
      }),
    );

    expect(hashKaufvertragSnapshot(changed)).not.toBe(
      hashKaufvertragSnapshot(base),
    );
  });

  it('is a 64-character lowercase hex digest', () => {
    expect(hashKaufvertragSnapshot(buildKaufvertragSnapshot(input()))).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });
});

describe('Kaufvertrag archive identity', () => {
  it('builds a tenant-, sale-, snapshot- and template-scoped object key', () => {
    expect(
      buildKaufvertragArchiveKey({
        tenantId: 'tenant-a',
        saleId: 'sale-1',
        snapshotSha256: 'a'.repeat(64),
      }),
    ).toBe(
      `vehicle-sale-kaufvertrag-archives/tenant-a/sale-1/${'a'.repeat(64)}/${KAUFVERTRAG_TEMPLATE_VERSION}.pdf`,
    );
  });

  it('builds the custom metadata identity written next to the object', () => {
    expect(
      buildKaufvertragArchiveIdentity({
        tenantId: 'tenant-a',
        saleId: 'sale-1',
        snapshotSha256: 'b'.repeat(64),
      }),
    ).toEqual({
      tenant_id: 'tenant-a',
      vehicle_sale_id: 'sale-1',
      snapshot_sha256: 'b'.repeat(64),
      template_version: KAUFVERTRAG_TEMPLATE_VERSION,
    });
  });
});
