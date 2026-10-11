import { DEFAULT_DOCUMENT_BRAND_THEME } from '../document-branding/theme-v1.js';
import {
  maskBankValue,
  MCP_INVOICE_CURRENCY,
  toMcpAccountingProfileStatus,
  toMcpBrandingSummary,
  toMcpLegalEntity,
  toMcpNumberRanges,
  toMcpSiteRow,
  toMcpTaxRates,
  toMcpTenantSettings,
  type McpLegalEntityRecord,
  type McpRevenueGroupRecord,
} from './mcp-settings-read.mapper.js';

const LEGAL_ENTITY_ID = '00000000-0000-4000-8000-0000000000e1';
const SITE_ID = '00000000-0000-4000-8000-0000000000a1';

const IBAN = 'AT611904300234573201';
const BIC = 'TESTATWW';
const BANK_NAME = 'Testbank Wien';
const VAT_ID = 'ATU12345678';
const REPRESENTATIVE = 'Erika Beispiel';

function legalEntity(
  overrides: Partial<McpLegalEntityRecord> = {},
): McpLegalEntityRecord {
  return {
    id: LEGAL_ENTITY_ID,
    is_active: true,
    name: 'Test Werkstatt GmbH',
    country_iso: 'AT',
    address_street: 'Testgasse 1',
    address_line2: null,
    address_zip: '1010',
    address_city: 'Wien',
    tax_number: '12 345/6789',
    vat_id: VAT_ID,
    iban: IBAN,
    bic: BIC,
    bank_name: BANK_NAME,
    email: 'office@example.invalid',
    phone: '+43 1 000000',
    registration_number: 'FN 000000 x',
    registration_court: 'Handelsgericht Wien',
    representatives: REPRESENTATIVE,
    payment_terms_days: 14,
    payment_terms_text: 'Zahlbar innerhalb von 14 Tagen.',
    ...overrides,
  };
}

function decimal(value: string) {
  return {
    toFixed: (decimalPlaces: number) => Number(value).toFixed(decimalPlaces),
    toString: () => value,
  };
}

function revenueGroup(
  overrides: Partial<McpRevenueGroupRecord> = {},
): McpRevenueGroupRecord {
  return {
    id: 1,
    name: 'Service',
    tax_rate: decimal('20'),
    account_number: '8400',
    is_default: true,
    ...overrides,
  };
}

describe('maskBankValue', () => {
  it('keeps only the last four characters of an IBAN', () => {
    expect(maskBankValue(IBAN)).toBe('****3201');
  });

  it('trims surrounding whitespace before masking', () => {
    expect(maskBankValue('  DE89370400440532013000  ')).toBe('****3000');
  });

  it('shows at most half of a value of five to seven characters', () => {
    expect(maskBankValue('ABCDE')).toBe('****DE');
    expect(maskBankValue('ABCDEFG')).toBe('****EFG');
  });

  it('shows the last four characters of a value of eight or more characters', () => {
    expect(maskBankValue('ABCDEFGH')).toBe('****EFGH');
  });

  it('shows only the mask for a value of four characters or fewer', () => {
    expect(maskBankValue('ABCD')).toBe('****');
    expect(maskBankValue('BIC')).toBe('****');
  });

  it('returns null for a missing, empty, or blank value', () => {
    expect(maskBankValue(null)).toBeNull();
    expect(maskBankValue(undefined)).toBeNull();
    expect(maskBankValue('')).toBeNull();
    expect(maskBankValue('   ')).toBeNull();
  });

  it('never leaks the leading characters of a value', () => {
    expect(maskBankValue(IBAN)).not.toContain('AT6119');
  });
});

describe('toMcpSiteRow', () => {
  it('builds one address line from street, postcode and city, and country', () => {
    expect(
      toMcpSiteRow({
        id: SITE_ID,
        name: 'Hauptstandort',
        is_active: true,
        address_street: 'Testgasse 1',
        address_zip: '1010',
        address_city: 'Wien',
        address_country: 'AT',
      }),
    ).toEqual({
      id: SITE_ID,
      name: 'Hauptstandort',
      address_summary: 'Testgasse 1, 1010 Wien, AT',
      active: true,
    });
  });

  it('leaves out address parts that are not set', () => {
    expect(
      toMcpSiteRow({
        id: SITE_ID,
        name: 'Außenstelle',
        is_active: false,
        address_street: null,
        address_zip: null,
        address_city: 'Graz',
        address_country: null,
      }).address_summary,
    ).toBe('Graz');
  });

  it('reports no address summary when no address part is set', () => {
    expect(
      toMcpSiteRow({
        id: SITE_ID,
        name: 'Ohne Adresse',
        is_active: true,
        address_street: ' ',
        address_zip: null,
        address_city: null,
        address_country: null,
      }).address_summary,
    ).toBeNull();
  });
});

describe('toMcpLegalEntity', () => {
  const parts = {
    accountingProfile: toMcpAccountingProfileStatus({
      countryIso: 'AT',
      profile: null,
      revenueGroups: [],
    }),
    taxRates: [],
    numberRanges: [],
  };

  it('reduces every bank identifier to its last four characters', () => {
    const result = toMcpLegalEntity(legalEntity(), parts);

    expect(result.bank).toEqual({
      iban: '****3201',
      bic: '****ATWW',
      bank_name: '****Wien',
    });
  });

  it('keeps the full bank identifiers out of the serialized result', () => {
    const serialized = JSON.stringify(toMcpLegalEntity(legalEntity(), parts));

    expect(serialized).not.toContain(IBAN);
    expect(serialized).not.toContain('AT61190430023457');
    expect(serialized).not.toContain(BIC);
    expect(serialized).not.toContain(BANK_NAME);
  });

  it('never returns representatives, which are personal names', () => {
    const serialized = JSON.stringify(toMcpLegalEntity(legalEntity(), parts));

    expect(serialized).not.toContain(REPRESENTATIVE);
    expect(serialized).not.toContain('representatives');
  });

  it('names the seller fields the way the invoice snapshot does', () => {
    const result = toMcpLegalEntity(legalEntity(), parts);

    expect(result.seller).toEqual({
      name: 'Test Werkstatt GmbH',
      country_iso: 'AT',
      address_street: 'Testgasse 1',
      address_line2: null,
      address_zip: '1010',
      address_city: 'Wien',
      vat_id: VAT_ID,
      tax_number: '12 345/6789',
      registration_number: 'FN 000000 x',
      registration_court: 'Handelsgericht Wien',
      email: 'office@example.invalid',
      phone: '+43 1 000000',
    });
  });

  it('reports seller readiness from the same rules as the legal entity screen', () => {
    expect(toMcpLegalEntity(legalEntity(), parts).seller_readiness).toEqual({
      is_ready: true,
      missing_fields: [],
    });
    expect(
      toMcpLegalEntity(
        legalEntity({ country_iso: 'DE', vat_id: null, tax_number: null }),
        parts,
      ).seller_readiness,
    ).toEqual({
      is_ready: false,
      missing_fields: ['tax_number_or_vat_id'],
    });
    expect(
      toMcpLegalEntity(legalEntity({ vat_id: null }), parts).seller_readiness,
    ).toEqual({
      is_ready: false,
      missing_fields: ['vat_id'],
    });
  });
});

describe('toMcpAccountingProfileStatus', () => {
  it('reports a legal entity without a profile row as not configured, without creating one', () => {
    expect(
      toMcpAccountingProfileStatus({
        countryIso: 'AT',
        profile: null,
        revenueGroups: [revenueGroup()],
      }),
    ).toMatchObject({
      configured: false,
      is_enabled: false,
      is_ready: false,
    });
  });

  it('reports the enabled flag and readiness, and never returns the client identifiers', () => {
    const status = toMcpAccountingProfileStatus({
      countryIso: 'AT',
      profile: {
        is_enabled: true,
        profile_code: 'ACP-DATEV-AT-EUR-1',
        advisor_number: '99991',
        client_number: '88882',
        account_length: 4,
        default_debtor_account: '1000',
        mapping_rules: [],
      },
      revenueGroups: [revenueGroup()],
    });

    expect(status).toMatchObject({ configured: true, is_enabled: true });
    expect(status.is_ready).toBe(false);
    expect(status.unmapped_categories.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain('99991');
    expect(serialized).not.toContain('88882');
  });
});

describe('toMcpTaxRates', () => {
  it('returns each revenue group rate with two decimals', () => {
    expect(
      toMcpTaxRates([
        revenueGroup(),
        revenueGroup({
          id: 2,
          name: 'Ersatzteile',
          tax_rate: decimal('10'),
          account_number: '8200',
          is_default: false,
        }),
      ]),
    ).toEqual([
      {
        name: 'Service',
        tax_rate: '20.00',
        account_number: '8400',
        is_default: true,
      },
      {
        name: 'Ersatzteile',
        tax_rate: '10.00',
        account_number: '8200',
        is_default: false,
      },
    ]);
  });
});

describe('toMcpNumberRanges', () => {
  const finance = {
    sales_order_prefix: 'SO-2026-',
    next_sales_order_number: 1001,
    workshop_order_prefix: 'WO-2026-',
    next_workshop_order_number: 57,
    vehicle_purchase_prefix: 'VP-2026-',
    next_vehicle_purchase_number: 3,
    vehicle_sale_prefix: 'VS-2026-',
    next_vehicle_sale_number: 4,
    stock_transfer_prefix: 'TR-2026-',
    next_stock_transfer_number: 5,
  };

  it('reports the next number of each per-year sequence for the current year', () => {
    const ranges = toMcpNumberRanges({
      calendarYear: 2026,
      estimateYear: 2026,
      invoice: { current: 41 },
      creditNote: { current: 2 },
      workshopEstimate: { current: 9 },
      finance,
    });

    expect(ranges.find((range) => range.document === 'invoice')).toEqual({
      document: 'invoice',
      year: 2026,
      prefix: 'RE-2026-',
      next_number: 42,
    });
    expect(ranges.find((range) => range.document === 'credit_note')).toEqual({
      document: 'credit_note',
      year: 2026,
      prefix: 'CN-2026-',
      next_number: 3,
    });
    expect(
      ranges.find((range) => range.document === 'workshop_estimate'),
    ).toEqual({
      document: 'workshop_estimate',
      year: 2026,
      prefix: 'KV-2026-',
      next_number: 10,
    });
  });

  it('starts a sequence that has no row at 1', () => {
    const invoice = toMcpNumberRanges({
      calendarYear: 2026,
      estimateYear: 2026,
      invoice: null,
      creditNote: null,
      workshopEstimate: null,
      finance: null,
    }).find((range) => range.document === 'invoice');

    expect(invoice?.next_number).toBe(1);
  });

  it('reports the finance counters for orders, vehicle documents, and transfers', () => {
    const ranges = toMcpNumberRanges({
      calendarYear: 2026,
      estimateYear: 2026,
      invoice: null,
      creditNote: null,
      workshopEstimate: null,
      finance,
    });

    expect(ranges.find((range) => range.document === 'sales_order')).toEqual({
      document: 'sales_order',
      year: null,
      prefix: 'SO-2026-',
      next_number: 1001,
    });
    expect(ranges.find((range) => range.document === 'stock_transfer')).toEqual(
      {
        document: 'stock_transfer',
        year: null,
        prefix: 'TR-2026-',
        next_number: 5,
      },
    );
  });

  it('reports null for finance counters when the tenant has no settings row', () => {
    const salesOrder = toMcpNumberRanges({
      calendarYear: 2026,
      estimateYear: 2026,
      invoice: null,
      creditNote: null,
      workshopEstimate: null,
      finance: null,
    }).find((range) => range.document === 'sales_order');

    expect(salesOrder).toEqual({
      document: 'sales_order',
      year: null,
      prefix: null,
      next_number: null,
    });
  });
});

describe('toMcpBrandingSummary', () => {
  it('summarizes a confirmed theme without asset IDs or free text', () => {
    const summary = toMcpBrandingSummary(
      { id: LEGAL_ENTITY_ID, name: 'Test Werkstatt GmbH' },
      {
        active_revision: 3,
        confirmed_at: new Date('2026-09-01T10:00:00.000Z'),
        active_logo_asset_id: '00000000-0000-4000-8000-0000000000b1',
        active_theme: {
          ...DEFAULT_DOCUMENT_BRAND_THEME,
          logoAssetId: '00000000-0000-4000-8000-0000000000b1',
          headerBand: 'primary',
          headerText: 'Vertraulicher Kopftext',
        },
        draft_theme: null,
      },
    );

    expect(summary).toEqual({
      legal_entity_id: LEGAL_ENTITY_ID,
      legal_entity_name: 'Test Werkstatt GmbH',
      is_confirmed: true,
      confirmed_at: '2026-09-01T10:00:00.000Z',
      active_revision: 3,
      has_logo: true,
      has_draft: false,
      theme: {
        primary_color: '#111827',
        secondary_color: '#E5E7EB',
        font_id: 'acp-sans-v1',
        header_band: 'primary',
        footer_band: 'none',
        header_text_set: true,
        footer_text_set: false,
      },
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('00000000-0000-4000-8000-0000000000b1');
    expect(serialized).not.toContain('Vertraulicher Kopftext');
  });

  it('reports an entity without a branding profile as unconfigured with the default theme', () => {
    expect(
      toMcpBrandingSummary({ id: LEGAL_ENTITY_ID, name: 'Neu' }, null),
    ).toMatchObject({
      is_confirmed: false,
      confirmed_at: null,
      active_revision: 0,
      has_logo: false,
      has_draft: false,
    });
  });
});

describe('toMcpTenantSettings', () => {
  const PROJECT_ID = 'acp-voice-project-secret';
  const SERVICE_ACCOUNT_BLOB = 'ENCRYPTED-SERVICE-ACCOUNT-BLOB';
  const IDENTITY_SECRET_REF = 'projects/acp/secrets/identity-key-ref';
  const PARTS_SECRET_REF = 'projects/acp/secrets/parts-key-ref';

  function settings(
    overrides: Partial<Parameters<typeof toMcpTenantSettings>[0]> = {},
  ) {
    return toMcpTenantSettings({
      decisionApplyMode: 'shadow',
      activeSiteTimezone: 'Europe/Vienna',
      voice: {
        target_language_code: 'de',
        google_project_id: PROJECT_ID,
        google_service_account_encrypted: SERVICE_ACCOUNT_BLOB,
      },
      catalog: {
        default_identity_adapter_id: 'identity-adapter',
        default_parts_aftermarket_adapter_id: null,
        default_labor_aftermarket_adapter_id: null,
        aw_minutes: 6,
        identity_credentials_secret_ref: IDENTITY_SECRET_REF,
        parts_aftermarket_credentials_secret_ref: PARTS_SECRET_REF,
        labor_aftermarket_credentials_secret_ref: null,
      },
      tyre: null,
      legalEntities: [],
      ...overrides,
    });
  }

  it('reports the currency, the active site timezone, and the decision apply mode', () => {
    const result = settings();

    expect(result.currency).toBe(MCP_INVOICE_CURRENCY);
    expect(result.currency).toBe('EUR');
    expect(result.active_site_timezone).toBe('Europe/Vienna');
    expect(result.feature_flags.decision_apply_mode).toBe('shadow');
  });

  it('does not invent a tenant locale, which the schema does not store', () => {
    expect(settings()).not.toHaveProperty('locale');
  });

  it('reports voice and catalog configuration as booleans and never returns a secret value', () => {
    const result = settings();
    const serialized = JSON.stringify(result);

    expect(result.feature_flags.voice_translation).toEqual({
      target_language_code: 'de',
      configured: true,
    });
    expect(result.feature_flags.catalog.credentials_configured).toEqual({
      identity: true,
      parts_aftermarket: true,
      labor_aftermarket: false,
    });
    expect(serialized).not.toContain(PROJECT_ID);
    expect(serialized).not.toContain(SERVICE_ACCOUNT_BLOB);
    expect(serialized).not.toContain(IDENTITY_SECRET_REF);
    expect(serialized).not.toContain(PARTS_SECRET_REF);
    expect(serialized).not.toContain('secret');
  });

  it('reports voice translation as not configured when the secret material is missing', () => {
    expect(
      settings({
        voice: {
          target_language_code: 'de',
          google_project_id: PROJECT_ID,
          google_service_account_encrypted: null,
        },
      }).feature_flags.voice_translation.configured,
    ).toBe(false);
  });

  it('uses the column defaults when a settings row is missing', () => {
    const result = settings({ voice: null, catalog: null, tyre: null });

    expect(result.feature_flags.voice_translation).toEqual({
      target_language_code: 'de',
      configured: false,
    });
    expect(result.feature_flags.catalog.aw_minutes).toBe(6);
    expect(result.feature_flags.tyre_storage).toEqual({
      summer_swap_date: '03-01',
      winter_swap_date: '10-01',
      due_for_swap_days: 30,
    });
  });

  it('formats tyre swap dates as month and day', () => {
    expect(
      settings({
        tyre: {
          summer_swap_month: 4,
          summer_swap_day: 15,
          winter_swap_month: 11,
          winter_swap_day: 1,
          due_for_swap_days: 14,
        },
      }).feature_flags.tyre_storage,
    ).toEqual({
      summer_swap_date: '04-15',
      winter_swap_date: '11-01',
      due_for_swap_days: 14,
    });
  });

  it('lists a branding summary per legal entity', () => {
    const result = settings({
      legalEntities: [
        {
          entity: { id: LEGAL_ENTITY_ID, name: 'Test Werkstatt GmbH' },
          branding: null,
        },
      ],
    });

    expect(result.document_branding).toHaveLength(1);
    expect(result.document_branding[0]).toMatchObject({
      legal_entity_id: LEGAL_ENTITY_ID,
      is_confirmed: false,
    });
  });
});
