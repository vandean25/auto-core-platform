import type { LegalEntityAccountingProfile } from '@prisma/client';
import {
  buildRequiredSourceCategories,
  computeAccountingProfileReadiness,
} from './accounting-profile-readiness.js';
import {
  type AccountingMappingRule,
  type SourceCategoryDefinition,
} from './accounting-profile.types.js';

export type AccountingProfileResponse = {
  id: string;
  tenant_id: string;
  legal_entity_id: string;
  version: number;
  is_enabled: boolean;
  profile_code: string | null;
  format_version: string | null;
  chart: string | null;
  account_length: number | null;
  advisor_number: string | null;
  client_number: string | null;
  fiscal_year_start_month: number | null;
  default_debtor_account: string | null;
  mapping_rules: AccountingMappingRule[];
  required_source_categories: SourceCategoryDefinition[];
  mapping_readiness: {
    is_ready: boolean;
    missing_fields: string[];
    unmapped_categories: string[];
  };
};

function parseMappingRules(value: unknown): AccountingMappingRule[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value as AccountingMappingRule[];
}

export function toAccountingProfileResponse(
  profile: LegalEntityAccountingProfile,
  countryIso: 'AT' | 'DE',
  revenueGroups: {
    id: number;
    name: string;
    tax_rate: { toString(): string };
    account_number: string;
  }[],
): AccountingProfileResponse {
  const mappingRules = parseMappingRules(profile.mapping_rules);
  const requiredSourceCategories = buildRequiredSourceCategories(revenueGroups);
  const readiness = computeAccountingProfileReadiness({
    countryIso,
    advisorNumber: profile.advisor_number,
    clientNumber: profile.client_number,
    accountLength: profile.account_length,
    defaultDebtorAccount: profile.default_debtor_account,
    mappingRules,
    requiredSourceCategories,
  });

  return {
    id: profile.id,
    tenant_id: profile.tenant_id,
    legal_entity_id: profile.legal_entity_id,
    version: profile.version,
    is_enabled: profile.is_enabled,
    profile_code: profile.profile_code,
    format_version: profile.format_version,
    chart: profile.chart,
    account_length: profile.account_length,
    advisor_number: profile.advisor_number,
    client_number: profile.client_number,
    fiscal_year_start_month: profile.fiscal_year_start_month,
    default_debtor_account: profile.default_debtor_account,
    mapping_rules: mappingRules,
    required_source_categories: requiredSourceCategories,
    mapping_readiness: {
      is_ready: readiness.isReady,
      missing_fields: readiness.missingFields,
      unmapped_categories: readiness.unmappedCategories,
    },
  };
}
