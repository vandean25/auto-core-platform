export const DEFAULT_DE_PROFILE_CODE = 'ACP-DATEV-DE-EUR-1';
export const DEFAULT_FORMAT_VERSION = 'EXTF-700-Buchungsstapel-13';

export const FIXED_SOURCE_CATEGORY_KEYS = {
  LABOR: 'labor',
  MANUAL_LINE: 'manual_line',
  VEHICLE_MARGIN: 'vehicle_margin',
} as const;

export type FixedSourceCategoryKey =
  (typeof FIXED_SOURCE_CATEGORY_KEYS)[keyof typeof FIXED_SOURCE_CATEGORY_KEYS];

export type AccountingTaxMode = 'STANDARD' | 'MARGIN_SCHEME';

export type AccountingTaxTreatment = 'automatic' | 'manual_bu';

export type AccountingMappingRule = {
  sourceCategoryKey: string;
  sourceCategoryLabel: string;
  taxMode: AccountingTaxMode;
  taxRate: string;
  revenueAccount: string;
  taxTreatment: AccountingTaxTreatment;
  buKey?: string | null;
};

export type SourceCategoryDefinition = {
  key: string;
  label: string;
  taxMode: AccountingTaxMode;
  taxRate: string;
  suggestedRevenueAccount?: string | null;
};

export type ResolvedAccountingAllocation = {
  profileCode: string | null;
  profileVersion: number;
  sourceCategoryKey: string;
  sourceCategoryLabel: string;
  revenueAccount: string;
  debtorAccount: string;
  taxMode: AccountingTaxMode;
  taxRate: string;
  taxTreatment: AccountingTaxTreatment;
  buKey: string | null;
  countryIso: 'AT' | 'DE';
  currency: 'EUR';
};

export function revenueGroupSourceCategoryKey(revenueGroupId: number): string {
  return `revenue_group:${revenueGroupId}`;
}

export function parseRevenueGroupSourceCategoryKey(key: string): number | null {
  const match = /^revenue_group:(\d+)$/.exec(key);
  return match ? Number.parseInt(match[1], 10) : null;
}
