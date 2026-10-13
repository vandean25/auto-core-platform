import { isRzlProfileCode } from '../accounting-profile/accounting-profile.codes.js';
import {
  parseAccountingProfileSerializerParams,
  type RzlSteuercodes,
} from '../accounting-profile/accounting-profile.serializer-params.js';
import { isRzlSafeText } from '../accounting-profile/rzl-text-rules.js';
import type { AccountingExportBlockerCode } from './accounting-export.types.js';
import type { ResolvedAccountingAllocation } from '../accounting-profile/accounting-profile.types.js';
import { RZL_STEUERCODE_KEY_BY_TAX_RATE } from './rzl-format.constants.js';

export type AccountingExportRuleIssue = {
  code: AccountingExportBlockerCode;
  message: string;
};

/**
 * Per-profile checks applied to each frozen line allocation. The default
 * (DATEV) rules keep the historical blocker messages unchanged.
 */
export type AccountingExportAllocationRules = {
  countryIso: 'DE' | 'AT';
  unsupportedCountryMessage: string;
  allowManualBu: boolean;
  taxRateIssue(taxRate: string): AccountingExportRuleIssue | null;
  /** Optional per-allocation check for text the export file cannot carry. */
  allocationIssue?(
    allocation: ResolvedAccountingAllocation,
  ): AccountingExportRuleIssue | null;
};

export const DATEV_ALLOCATION_RULES: AccountingExportAllocationRules = {
  countryIso: 'DE',
  unsupportedCountryMessage:
    'Only DE domestic STANDARD VAT exports are enabled in slice 1.',
  allowManualBu: true,
  taxRateIssue: () => null,
};

/**
 * RZL: AT STANDARD VAT only, rate-based Steuercodes, no DATEV BU keys. Zero-rate
 * lines are blocked on purpose: exempt, reverse-charge and intra-community
 * treatments (RZL codes 01/02/03 in the brief) are deferred, and ACP never
 * infers them from a zero rate.
 */
export function buildRzlAllocationRules(
  steuercodes: RzlSteuercodes,
): AccountingExportAllocationRules {
  return {
    countryIso: 'AT',
    unsupportedCountryMessage:
      'Only AT STANDARD VAT allocations can be exported with the RZL profile.',
    allowManualBu: false,
    allocationIssue(allocation) {
      const accounts = [
        ['Revenue account', allocation.revenueAccount],
        ['Debtor account', allocation.debtorAccount],
      ] as const;
      for (const [label, account] of accounts) {
        if (!isRzlSafeText(account)) {
          return {
            code: 'ACCOUNTING_MAPPING_INCOMPLETE',
            message: `${label} ${account} cannot be written to an RZL file. Use plain text without ; or quotes.`,
          };
        }
      }
      return null;
    },
    taxRateIssue(taxRate) {
      const normalized = Number(taxRate).toFixed(2);
      if (normalized === '0.00') {
        return {
          code: 'UNSUPPORTED_EXPORT_TAX_MODE',
          message:
            'Zero-rate VAT has no approved RZL Steuercode in this profile version. Exempt, reverse-charge and intra-community treatments are deferred.',
        };
      }
      const key = RZL_STEUERCODE_KEY_BY_TAX_RATE.get(normalized);
      if (!key) {
        return {
          code: 'UNSUPPORTED_EXPORT_TAX_MODE',
          message: `VAT rate ${normalized}% has no RZL Steuercode in this profile version.`,
        };
      }
      if (!steuercodes[key]?.trim()) {
        return {
          code: 'ACCOUNTING_MAPPING_INCOMPLETE',
          message: `The RZL Steuercode for ${normalized}% VAT is not configured.`,
        };
      }
      return null;
    },
  };
}

/** Rules for a profile code and its stored serializer params (null or unknown codes keep DATEV rules). */
export function allocationRulesForProfile(
  profileCode: string | null,
  serializerParams: unknown,
): AccountingExportAllocationRules {
  if (!isRzlProfileCode(profileCode)) {
    return DATEV_ALLOCATION_RULES;
  }
  const rzl = parseAccountingProfileSerializerParams(serializerParams).rzl;
  return buildRzlAllocationRules(rzl?.steuercodes ?? {});
}
