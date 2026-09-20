import type { LegalEntityCountry } from '@prisma/client';
import {
  type AccountingMappingRule,
  type SourceCategoryDefinition,
  FIXED_SOURCE_CATEGORY_KEYS,
} from './accounting-profile.types.js';

export type AccountingProfileReadinessInput = {
  countryIso: LegalEntityCountry;
  advisorNumber: string | null;
  clientNumber: string | null;
  accountLength: number | null;
  defaultDebtorAccount: string | null;
  mappingRules: AccountingMappingRule[];
  requiredSourceCategories: SourceCategoryDefinition[];
};

export type AccountingProfileReadiness = {
  isReady: boolean;
  missingFields: string[];
  unmappedCategories: string[];
};

function hasMappingForCategory(
  rules: AccountingMappingRule[],
  category: SourceCategoryDefinition,
): boolean {
  return rules.some(
    (rule) =>
      rule.sourceCategoryKey === category.key &&
      rule.taxMode === category.taxMode &&
      rule.taxRate === category.taxRate &&
      rule.revenueAccount.trim().length > 0 &&
      (rule.taxTreatment === 'automatic' ||
        (rule.taxTreatment === 'manual_bu' && Boolean(rule.buKey?.trim()))),
  );
}

export function computeAccountingProfileReadiness(
  input: AccountingProfileReadinessInput,
): AccountingProfileReadiness {
  const missingFields: string[] = [];
  const unmappedCategories: string[] = [];

  if (!input.advisorNumber?.trim()) {
    missingFields.push('advisor_number');
  }
  if (!input.clientNumber?.trim()) {
    missingFields.push('client_number');
  }
  if (input.accountLength === null || input.accountLength < 1) {
    missingFields.push('account_length');
  }
  if (!input.defaultDebtorAccount?.trim()) {
    missingFields.push('default_debtor_account');
  }

  for (const category of input.requiredSourceCategories) {
    if (!hasMappingForCategory(input.mappingRules, category)) {
      unmappedCategories.push(category.key);
    }
  }

  if (unmappedCategories.length > 0) {
    missingFields.push('mapping_rules');
  }

  return {
    isReady: missingFields.length === 0,
    missingFields,
    unmappedCategories,
  };
}

export function buildRequiredSourceCategories(
  revenueGroups: {
    id: number;
    name: string;
    tax_rate: { toString(): string };
    account_number: string;
  }[],
): SourceCategoryDefinition[] {
  const revenueCategories = revenueGroups.map((group) => ({
    key: `revenue_group:${group.id}`,
    label: group.name,
    taxMode: 'STANDARD' as const,
    taxRate: group.tax_rate.toString(),
    suggestedRevenueAccount: group.account_number,
  }));

  const fixedCategories: SourceCategoryDefinition[] = [
    {
      key: FIXED_SOURCE_CATEGORY_KEYS.LABOR,
      label: 'Labor / workshop services',
      taxMode: 'STANDARD',
      taxRate: revenueGroups[0]?.tax_rate.toString() ?? '20.00',
      suggestedRevenueAccount: null,
    },
    {
      key: FIXED_SOURCE_CATEGORY_KEYS.MANUAL_LINE,
      label: 'Manual invoice lines',
      taxMode: 'STANDARD',
      taxRate: revenueGroups[0]?.tax_rate.toString() ?? '20.00',
      suggestedRevenueAccount: null,
    },
    {
      key: FIXED_SOURCE_CATEGORY_KEYS.VEHICLE_MARGIN,
      label: 'Vehicle margin scheme',
      taxMode: 'MARGIN_SCHEME',
      taxRate: '0.00',
      suggestedRevenueAccount: null,
    },
  ];

  return [...revenueCategories, ...fixedCategories];
}
