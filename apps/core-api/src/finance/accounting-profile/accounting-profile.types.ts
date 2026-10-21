export {
  DEFAULT_DE_PROFILE_CODE,
  DEFAULT_FORMAT_VERSION,
} from './accounting-profile.codes.js';

export const FIXED_SOURCE_CATEGORY_KEYS = {
  LABOR: 'labor',
  MANUAL_LINE: 'manual_line',
  VEHICLE_MARGIN: 'vehicle_margin',
} as const;

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
