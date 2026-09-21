import type { RevenueGroup } from '@prisma/client';
import {
  DEFAULT_DE_PROFILE_CODE,
  DEFAULT_FORMAT_VERSION,
  FIXED_SOURCE_CATEGORY_KEYS,
  type AccountingMappingRule,
  revenueGroupSourceCategoryKey,
} from '../../finance/accounting-profile/accounting-profile.types.js';
import type { SeedPrismaClient } from './types.js';

/**
 * DATEV-oriented accounting profile for the `default-workshop` demo legal entity (AUT-314).
 *
 * `is_enabled` stays false so DATEV export remains gated (M4); invoice finalize still
 * requires a profile row and complete mappings for fiscal snapshot allocation.
 */
export const DEMO_WORKSHOP_ACCOUNTING_PROFILE_DEFAULTS = {
  profile_code: DEFAULT_DE_PROFILE_CODE,
  format_version: DEFAULT_FORMAT_VERSION,
  chart: 'SKR03',
  advisor_number: '12345',
  client_number: '1',
  account_length: 4,
  fiscal_year_start_month: 1,
  default_debtor_account: '1000',
  is_enabled: false,
} as const;

export function buildDemoWorkshopAccountingMappingRules(
  revenueGroups: Pick<
    RevenueGroup,
    'id' | 'name' | 'tax_rate' | 'account_number'
  >[],
): AccountingMappingRule[] {
  const standardTaxRate = revenueGroups[0]
    ? Number.parseFloat(revenueGroups[0].tax_rate.toString()).toFixed(2)
    : '20.00';

  const revenueGroupRules: AccountingMappingRule[] = revenueGroups.map(
    (group) => ({
      sourceCategoryKey: revenueGroupSourceCategoryKey(group.id),
      sourceCategoryLabel: group.name,
      taxMode: 'STANDARD',
      taxRate: Number.parseFloat(group.tax_rate.toString()).toFixed(2),
      revenueAccount: group.account_number,
      taxTreatment: 'automatic',
    }),
  );

  return [
    {
      sourceCategoryKey: FIXED_SOURCE_CATEGORY_KEYS.MANUAL_LINE,
      sourceCategoryLabel: 'Manual invoice lines',
      taxMode: 'STANDARD',
      taxRate: standardTaxRate,
      revenueAccount: '8400',
      taxTreatment: 'automatic',
    },
    {
      sourceCategoryKey: FIXED_SOURCE_CATEGORY_KEYS.LABOR,
      sourceCategoryLabel: 'Labor / workshop services',
      taxMode: 'STANDARD',
      taxRate: standardTaxRate,
      revenueAccount: '8500',
      taxTreatment: 'automatic',
    },
    {
      sourceCategoryKey: FIXED_SOURCE_CATEGORY_KEYS.VEHICLE_MARGIN,
      sourceCategoryLabel: 'Vehicle margin scheme',
      taxMode: 'MARGIN_SCHEME',
      taxRate: '0.00',
      revenueAccount: '8600',
      taxTreatment: 'automatic',
    },
    ...revenueGroupRules,
  ];
}

export async function seedDemoWorkshopAccountingProfile(
  prisma: SeedPrismaClient,
  tenantId: string,
  legalEntityId: string,
  revenueGroups: Pick<
    RevenueGroup,
    'id' | 'name' | 'tax_rate' | 'account_number'
  >[],
) {
  const mapping_rules = buildDemoWorkshopAccountingMappingRules(revenueGroups);

  return prisma.legalEntityAccountingProfile.upsert({
    where: {
      tenant_id_legal_entity_id: {
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
      },
    },
    update: {
      ...DEMO_WORKSHOP_ACCOUNTING_PROFILE_DEFAULTS,
      mapping_rules,
    },
    create: {
      tenant_id: tenantId,
      legal_entity_id: legalEntityId,
      ...DEMO_WORKSHOP_ACCOUNTING_PROFILE_DEFAULTS,
      mapping_rules,
    },
  });
}
