import type { LegalEntityAccountingProfile } from '@prisma/client';
import {
  type AccountingMappingRule,
  type AccountingTaxMode,
  type ResolvedAccountingAllocation,
  FIXED_SOURCE_CATEGORY_KEYS,
  revenueGroupSourceCategoryKey,
} from './accounting-profile.types.js';

export type AccountingLineResolutionInput = {
  sourceCategoryKey: string;
  sourceCategoryLabel: string;
  taxMode: AccountingTaxMode;
  taxRate: string;
  revenueGroupId?: number | null;
};

function parseMappingRules(value: unknown): AccountingMappingRule[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value as AccountingMappingRule[];
}

export function resolveSourceCategoryKey(
  input: AccountingLineResolutionInput,
): string {
  if (input.taxMode === 'MARGIN_SCHEME') {
    return FIXED_SOURCE_CATEGORY_KEYS.VEHICLE_MARGIN;
  }
  if (input.revenueGroupId) {
    return revenueGroupSourceCategoryKey(input.revenueGroupId);
  }
  if (input.sourceCategoryKey) {
    return input.sourceCategoryKey;
  }
  return FIXED_SOURCE_CATEGORY_KEYS.MANUAL_LINE;
}

export function resolveAccountingAllocation(
  profile: LegalEntityAccountingProfile,
  countryIso: 'AT' | 'DE',
  input: AccountingLineResolutionInput,
): ResolvedAccountingAllocation | null {
  const mappingRules = parseMappingRules(profile.mapping_rules);
  const sourceCategoryKey = resolveSourceCategoryKey(input);
  const rule = mappingRules.find(
    (candidate) =>
      candidate.sourceCategoryKey === sourceCategoryKey &&
      candidate.taxMode === input.taxMode &&
      candidate.taxRate === input.taxRate,
  );

  if (!rule || !profile.default_debtor_account?.trim()) {
    return null;
  }

  return {
    profileCode: profile.profile_code,
    profileVersion: profile.version,
    sourceCategoryKey,
    sourceCategoryLabel: input.sourceCategoryLabel || rule.sourceCategoryLabel,
    revenueAccount: rule.revenueAccount,
    debtorAccount: profile.default_debtor_account,
    taxMode: input.taxMode,
    taxRate: input.taxRate,
    taxTreatment: rule.taxTreatment,
    buKey: rule.buKey ?? null,
    countryIso,
    currency: 'EUR',
  };
}
