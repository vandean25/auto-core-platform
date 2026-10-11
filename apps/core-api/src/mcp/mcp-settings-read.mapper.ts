import type { LegalEntityCountry } from '@prisma/client';
import {
  buildRequiredSourceCategories,
  computeAccountingProfileReadiness,
} from '../finance/accounting-profile/accounting-profile-readiness.js';
import type { AccountingMappingRule } from '../finance/accounting-profile/accounting-profile.types.js';
import type { DecisionApplyMode } from '../decision/decision.constants.js';
import {
  DEFAULT_DOCUMENT_BRAND_THEME,
  validateDocumentBrandTheme,
} from '../document-branding/theme-v1.js';
import { computeSellerReadiness } from '../site/legal-entity-readiness.js';
import type { LegalEntitySellerRecord } from '../site/legal-entity-seller.validation.js';

/** Invoice snapshots type the currency as the literal 'EUR', and no invoicing path writes another currency. */
export const MCP_INVOICE_CURRENCY = 'EUR' as const;

const BANK_MASK = '****';
const BANK_VISIBLE_CHARACTERS = 4;

/** Used when the tenant has no voice translation row. Matches the column default. */
const DEFAULT_VOICE_TARGET_LANGUAGE = 'de';

/** Used when the tenant has no catalog settings row. Matches the column default. */
const DEFAULT_AW_MINUTES = 6;

/** Used when the tenant has no tyre storage row. Matches the column defaults. */
const DEFAULT_TYRE_STORAGE = {
  summer_swap_month: 3,
  summer_swap_day: 1,
  winter_swap_month: 10,
  winter_swap_day: 1,
  due_for_swap_days: 30,
} as const;

function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isPresent(value: string | null): value is string {
  return value !== null;
}

/**
 * A bank identifier reduced to its last four characters, so two accounts can
 * still be told apart without the full value reaching the agent. A value of
 * four characters or fewer shows only the mask.
 */
export function maskBankValue(value: string | null | undefined): string | null {
  const trimmed = trimmedOrNull(value);
  if (trimmed === null) {
    return null;
  }
  if (trimmed.length <= BANK_VISIBLE_CHARACTERS) {
    return BANK_MASK;
  }
  return `${BANK_MASK}${trimmed.slice(-BANK_VISIBLE_CHARACTERS)}`;
}

function formatMonthDay(month: number, day: number): string {
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// --- Sites -----------------------------------------------------------------

export type McpSiteRecord = {
  id: string;
  name: string;
  is_active: boolean;
  address_street: string | null;
  address_zip: string | null;
  address_city: string | null;
  address_country: string | null;
};

export type McpSiteRow = {
  id: string;
  name: string;
  address_summary: string | null;
  active: boolean;
};

/** Street, then postcode and city, then country, on one line. Null when no address part is set. */
function addressSummary(site: McpSiteRecord): string | null {
  const postcodeCity = [
    trimmedOrNull(site.address_zip),
    trimmedOrNull(site.address_city),
  ]
    .filter(isPresent)
    .join(' ');
  const parts = [
    trimmedOrNull(site.address_street),
    postcodeCity || null,
    trimmedOrNull(site.address_country),
  ].filter(isPresent);
  return parts.length > 0 ? parts.join(', ') : null;
}

export function toMcpSiteRow(site: McpSiteRecord): McpSiteRow {
  return {
    id: site.id,
    name: site.name,
    address_summary: addressSummary(site),
    active: site.is_active,
  };
}

// --- Legal entity ----------------------------------------------------------

export type McpLegalEntityRecord = LegalEntitySellerRecord & {
  id: string;
  is_active: boolean;
};

export type McpAccountingProfileRecord = {
  is_enabled: boolean;
  profile_code: string | null;
  advisor_number: string | null;
  client_number: string | null;
  account_length: number | null;
  default_debtor_account: string | null;
  mapping_rules: unknown;
};

export type McpAccountingProfileStatus = {
  configured: boolean;
  is_enabled: boolean;
  is_ready: boolean;
  missing_fields: string[];
  unmapped_categories: string[];
};

export type McpRevenueGroupRecord = {
  id: number;
  name: string;
  tax_rate: { toFixed(decimalPlaces: number): string; toString(): string };
  account_number: string;
  is_default: boolean;
};

export type McpTaxRate = {
  name: string;
  tax_rate: string;
  account_number: string;
  is_default: boolean;
};

export type McpSequenceRecord = { current: number };

export type McpFinanceCounterRecord = {
  sales_order_prefix: string;
  next_sales_order_number: number;
  workshop_order_prefix: string;
  next_workshop_order_number: number;
  vehicle_purchase_prefix: string;
  next_vehicle_purchase_number: number;
  vehicle_sale_prefix: string;
  next_vehicle_sale_number: number;
  stock_transfer_prefix: string;
  next_stock_transfer_number: number;
};

export type McpNumberRange = {
  document: string;
  year: number | null;
  prefix: string | null;
  next_number: number | null;
};

function parseMappingRules(value: unknown): AccountingMappingRule[] {
  return Array.isArray(value) ? (value as AccountingMappingRule[]) : [];
}

/**
 * Accounting profile status as the export readiness check computes it. A
 * legal entity without a profile row reports the missing fields, not a default
 * profile, and the read never creates one.
 */
export function toMcpAccountingProfileStatus(input: {
  countryIso: LegalEntityCountry;
  profile: McpAccountingProfileRecord | null;
  revenueGroups: McpRevenueGroupRecord[];
}): McpAccountingProfileStatus {
  const readiness = computeAccountingProfileReadiness({
    countryIso: input.countryIso,
    profileCode: input.profile?.profile_code ?? null,
    advisorNumber: input.profile?.advisor_number ?? null,
    clientNumber: input.profile?.client_number ?? null,
    accountLength: input.profile?.account_length ?? null,
    defaultDebtorAccount: input.profile?.default_debtor_account ?? null,
    mappingRules: parseMappingRules(input.profile?.mapping_rules),
    requiredSourceCategories: buildRequiredSourceCategories(
      input.revenueGroups,
    ),
  });
  return {
    configured: input.profile !== null,
    is_enabled: input.profile?.is_enabled ?? false,
    is_ready: readiness.isReady,
    missing_fields: readiness.missingFields,
    unmapped_categories: readiness.unmappedCategories,
  };
}

export function toMcpTaxRates(groups: McpRevenueGroupRecord[]): McpTaxRate[] {
  return groups.map((group) => ({
    name: group.name,
    tax_rate: group.tax_rate.toFixed(2),
    account_number: group.account_number,
    is_default: group.is_default,
  }));
}

/**
 * Number ranges as the number generators consume them. Invoices, credit notes,
 * and workshop estimates use per-year sequences, so the range is the current
 * year. Orders, vehicle documents, and stock transfers use the finance counters.
 */
export function toMcpNumberRanges(input: {
  calendarYear: number;
  estimateYear: number;
  invoice: McpSequenceRecord | null;
  creditNote: McpSequenceRecord | null;
  workshopEstimate: McpSequenceRecord | null;
  finance: McpFinanceCounterRecord | null;
}): McpNumberRange[] {
  const yearly = (
    document: string,
    prefixStem: string,
    year: number,
    sequence: McpSequenceRecord | null,
  ): McpNumberRange => ({
    document,
    year,
    prefix: `${prefixStem}${year}-`,
    next_number: (sequence?.current ?? 0) + 1,
  });
  const counter = (
    document: string,
    prefix: string | undefined,
    next: number | undefined,
  ): McpNumberRange => ({
    document,
    year: null,
    prefix: prefix ?? null,
    next_number: next ?? null,
  });
  const finance = input.finance;

  return [
    yearly('invoice', 'RE-', input.calendarYear, input.invoice),
    yearly('credit_note', 'CN-', input.calendarYear, input.creditNote),
    yearly(
      'workshop_estimate',
      'KV-',
      input.estimateYear,
      input.workshopEstimate,
    ),
    counter(
      'sales_order',
      finance?.sales_order_prefix,
      finance?.next_sales_order_number,
    ),
    counter(
      'workshop_order',
      finance?.workshop_order_prefix,
      finance?.next_workshop_order_number,
    ),
    counter(
      'vehicle_purchase',
      finance?.vehicle_purchase_prefix,
      finance?.next_vehicle_purchase_number,
    ),
    counter(
      'vehicle_sale',
      finance?.vehicle_sale_prefix,
      finance?.next_vehicle_sale_number,
    ),
    counter(
      'stock_transfer',
      finance?.stock_transfer_prefix,
      finance?.next_stock_transfer_number,
    ),
  ];
}

/**
 * Seller identity as the invoice snapshot prints it, with the same field names
 * as the get_invoice seller block. Representatives are left out, because they
 * are personal names. Bank identifiers are masked by maskBankValue.
 */
export function toMcpLegalEntity(
  entity: McpLegalEntityRecord,
  parts: {
    accountingProfile: McpAccountingProfileStatus;
    taxRates: McpTaxRate[];
    numberRanges: McpNumberRange[];
  },
) {
  const readiness = computeSellerReadiness(entity);
  return {
    id: entity.id,
    is_active: entity.is_active,
    seller: {
      name: entity.name,
      country_iso: entity.country_iso,
      address_street: entity.address_street,
      address_line2: entity.address_line2,
      address_zip: entity.address_zip,
      address_city: entity.address_city,
      vat_id: entity.vat_id,
      tax_number: entity.tax_number,
      registration_number: entity.registration_number,
      registration_court: entity.registration_court,
      email: entity.email,
      phone: entity.phone,
    },
    bank: {
      iban: maskBankValue(entity.iban),
      bic: maskBankValue(entity.bic),
      bank_name: maskBankValue(entity.bank_name),
    },
    payment_terms: {
      days: entity.payment_terms_days,
      text: entity.payment_terms_text,
    },
    seller_readiness: {
      is_ready: readiness.isReady,
      missing_fields: readiness.missingFields,
    },
    accounting_profile: parts.accountingProfile,
    tax_rates: parts.taxRates,
    number_ranges: parts.numberRanges,
  };
}

// --- Tenant settings -------------------------------------------------------

export type McpBrandingRecord = {
  active_revision: number;
  confirmed_at: Date | null;
  active_logo_asset_id: string | null;
  active_theme: unknown;
  draft_theme: unknown;
};

/**
 * Branding summary for one legal entity. The theme is validated the same way
 * the branding API validates it. Asset IDs, storage keys, and free text are
 * never returned. Only whether header and footer text are set is reported.
 */
export function toMcpBrandingSummary(
  entity: { id: string; name: string },
  branding: McpBrandingRecord | null,
) {
  const theme = branding?.active_theme
    ? validateDocumentBrandTheme(branding.active_theme)
    : DEFAULT_DOCUMENT_BRAND_THEME;
  return {
    legal_entity_id: entity.id,
    legal_entity_name: entity.name,
    is_confirmed: Boolean(branding?.confirmed_at),
    confirmed_at: branding?.confirmed_at?.toISOString() ?? null,
    active_revision: branding?.active_revision ?? 0,
    has_logo: Boolean(branding?.active_logo_asset_id),
    has_draft: Boolean(branding?.draft_theme),
    theme: {
      primary_color: theme.primaryColor,
      secondary_color: theme.secondaryColor,
      font_id: theme.fontId,
      header_band: theme.headerBand,
      footer_band: theme.footerBand,
      header_text_set: theme.headerText.length > 0,
      footer_text_set: theme.footerText.length > 0,
    },
  };
}

export type McpVoiceSettingsRecord = {
  target_language_code: string;
  google_project_id: string | null;
  google_service_account_encrypted: string | null;
};

export type McpCatalogSettingsRecord = {
  default_identity_adapter_id: string | null;
  default_parts_aftermarket_adapter_id: string | null;
  default_labor_aftermarket_adapter_id: string | null;
  aw_minutes: number;
  identity_credentials_secret_ref: string | null;
  parts_aftermarket_credentials_secret_ref: string | null;
  labor_aftermarket_credentials_secret_ref: string | null;
};

export type McpTyreStorageRecord = {
  summer_swap_month: number;
  summer_swap_day: number;
  winter_swap_month: number;
  winter_swap_day: number;
  due_for_swap_days: number;
};

/**
 * Tenant settings with an explicit allowlist. Secret-bearing columns (the voice
 * service account blob, the project ID, and the credential secret references)
 * are read only to derive a boolean. Their values never enter the result.
 */
export function toMcpTenantSettings(input: {
  decisionApplyMode: DecisionApplyMode;
  activeSiteTimezone: string | null;
  voice: McpVoiceSettingsRecord | null;
  catalog: McpCatalogSettingsRecord | null;
  tyre: McpTyreStorageRecord | null;
  legalEntities: {
    entity: { id: string; name: string };
    branding: McpBrandingRecord | null;
  }[];
}) {
  const { voice, catalog, tyre } = input;
  const tyreSettings = tyre ?? DEFAULT_TYRE_STORAGE;
  return {
    currency: MCP_INVOICE_CURRENCY,
    active_site_timezone: input.activeSiteTimezone,
    feature_flags: {
      decision_apply_mode: input.decisionApplyMode,
      voice_translation: {
        target_language_code:
          voice?.target_language_code ?? DEFAULT_VOICE_TARGET_LANGUAGE,
        configured: Boolean(
          voice?.google_project_id && voice.google_service_account_encrypted,
        ),
      },
      catalog: {
        identity_adapter_id: catalog?.default_identity_adapter_id ?? null,
        parts_aftermarket_adapter_id:
          catalog?.default_parts_aftermarket_adapter_id ?? null,
        labor_aftermarket_adapter_id:
          catalog?.default_labor_aftermarket_adapter_id ?? null,
        aw_minutes: catalog?.aw_minutes ?? DEFAULT_AW_MINUTES,
        credentials_configured: {
          identity: Boolean(catalog?.identity_credentials_secret_ref),
          parts_aftermarket: Boolean(
            catalog?.parts_aftermarket_credentials_secret_ref,
          ),
          labor_aftermarket: Boolean(
            catalog?.labor_aftermarket_credentials_secret_ref,
          ),
        },
      },
      tyre_storage: {
        summer_swap_date: formatMonthDay(
          tyreSettings.summer_swap_month,
          tyreSettings.summer_swap_day,
        ),
        winter_swap_date: formatMonthDay(
          tyreSettings.winter_swap_month,
          tyreSettings.winter_swap_day,
        ),
        due_for_swap_days: tyreSettings.due_for_swap_days,
      },
    },
    document_branding: input.legalEntities.map(({ entity, branding }) =>
      toMcpBrandingSummary(entity, branding),
    ),
  };
}
