import { isRzlProfileCode } from '../accounting-profile/accounting-profile.codes.js';
import {
  parseAccountingProfileSerializerParams,
  type MarginSchemeSerializerParams,
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
/**
 * Margin-scheme availability for one profile. `enabled` is the entity's explicit
 * switch (AUT-369) and is only ever true on the DATEV rules. `vatAccount` receives
 * the frozen margin VAT.
 */
export type AccountingExportMarginSchemeRules = {
  enabled: boolean;
  vatAccount: string | null;
};

export type AccountingExportAllocationRules = {
  countryIso: 'DE' | 'AT';
  unsupportedCountryMessage: string;
  allowManualBu: boolean;
  marginScheme: AccountingExportMarginSchemeRules;
  taxRateIssue(taxRate: string): AccountingExportRuleIssue | null;
  /** Optional per-allocation check for text the export file cannot carry. */
  allocationIssue?(
    allocation: ResolvedAccountingAllocation,
  ): AccountingExportRuleIssue | null;
};

/**
 * DATEV rules for DE domestic STANDARD VAT. The margin scheme is off unless the
 * entity enabled it; `marginScheme` carries that switch and its VAT account.
 */
export function buildDatevAllocationRules(
  marginScheme: MarginSchemeSerializerParams | null = null,
): AccountingExportAllocationRules {
  return {
    countryIso: 'DE',
    unsupportedCountryMessage:
      'Only DE domestic STANDARD VAT exports are enabled in slice 1.',
    allowManualBu: true,
    marginScheme: {
      enabled: marginScheme?.enabled === true,
      vatAccount: marginScheme?.vatAccount ?? null,
    },
    taxRateIssue: () => null,
  };
}

export const DATEV_ALLOCATION_RULES: AccountingExportAllocationRules =
  buildDatevAllocationRules();

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
    // No approved RZL posting for margin-scheme documents: the switch never lifts them.
    marginScheme: { enabled: false, vatAccount: null },
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
    const marginScheme =
      parseAccountingProfileSerializerParams(serializerParams).marginScheme;
    return marginScheme
      ? buildDatevAllocationRules(marginScheme)
      : DATEV_ALLOCATION_RULES;
  }
  const rzl = parseAccountingProfileSerializerParams(serializerParams).rzl;
  return buildRzlAllocationRules(rzl?.steuercodes ?? {});
}
