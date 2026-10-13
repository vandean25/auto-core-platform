import { isRzlProfileCode } from '../accounting-profile/accounting-profile.codes.js';
import {
  parseAccountingProfileSerializerParams,
  parseMarginSchemeSerializerParams,
  type BmdSteuercodes,
  type MarginSchemeSerializerParams,
  type RzlSteuercodes,
  type SteuercodesByRate,
} from '../accounting-profile/accounting-profile.serializer-params.js';
import { isBmdProfileCode } from '../accounting-profile/bmd-profile.codes.js';
import { isBmdSafeText } from '../accounting-profile/bmd-text-rules.js';
import { isRzlSafeText } from '../accounting-profile/rzl-text-rules.js';
import type { AccountingExportBlockerCode } from './accounting-export.types.js';
import type { ResolvedAccountingAllocation } from '../accounting-profile/accounting-profile.types.js';
import { BMD_STEUERCODE_KEY_BY_TAX_RATE } from './bmd-format.constants.js';
import { RZL_STEUERCODE_KEY_BY_TAX_RATE } from './rzl-format.constants.js';

export type AccountingExportRuleIssue = {
  code: AccountingExportBlockerCode;
  message: string;
};

/**
 * Margin-scheme availability for one profile. `enabled` is the entity's explicit
 * switch (AUT-369) and is only ever true on the DATEV rules. `vatAccount` receives
 * the frozen margin VAT.
 */
export type AccountingExportMarginSchemeRules = {
  enabled: boolean;
  vatAccount: string | null;
};

/**
 * Per-profile checks applied to each frozen line allocation. The default
 * (DATEV) rules keep the historical blocker messages unchanged.
 */
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
 * Wording, text rule and tax keys per AT profile. RZL keeps the candidate step's
 * default manual BU blocker.
 */
const AT_STANDARD_VAT_PROFILES = {
  RZL: {
    article: 'an',
    textRule: isRzlSafeText,
    textHint: 'Use plain text without ; or quotes.',
    manualBuPerAllocation: false,
    steuercodeKeyByRate: RZL_STEUERCODE_KEY_BY_TAX_RATE,
  },
  BMD: {
    article: 'a',
    textRule: isBmdSafeText,
    textHint: 'Use plain printable ASCII without ; or quotes.',
    manualBuPerAllocation: true,
    steuercodeKeyByRate: BMD_STEUERCODE_KEY_BY_TAX_RATE,
  },
} as const;

/**
 * AT STANDARD VAT only, rate-based Steuercodes, no DATEV BU keys. Zero-rate
 * lines are blocked on purpose: exempt, reverse-charge and intra-community
 * treatments are deferred, and ACP never infers them from a zero rate.
 *
 * BMD manual BU keys pass the candidate step and are blocked per allocation with
 * the BMD wording.
 */
function buildAtStandardVatRules(
  name: keyof typeof AT_STANDARD_VAT_PROFILES,
  steuercodes: SteuercodesByRate,
): AccountingExportAllocationRules {
  const profile = AT_STANDARD_VAT_PROFILES[name];
  return {
    countryIso: 'AT',
    unsupportedCountryMessage: `Only AT STANDARD VAT allocations can be exported with the ${name} profile.`,
    allowManualBu: profile.manualBuPerAllocation,
    // No approved RZL or BMD posting for margin-scheme documents: the switch never lifts them.
    marginScheme: { enabled: false, vatAccount: null },
    allocationIssue(allocation) {
      if (
        profile.manualBuPerAllocation &&
        allocation.taxTreatment === 'manual_bu'
      ) {
        return {
          code: 'ACCOUNTING_MAPPING_INCOMPLETE',
          message: `Manual BU keys are not used by the ${name} profile. Use automatic tax treatment.`,
        };
      }
      const accounts = [
        ['Revenue account', allocation.revenueAccount],
        ['Debtor account', allocation.debtorAccount],
      ] as const;
      for (const [label, account] of accounts) {
        if (!profile.textRule(account)) {
          return {
            code: 'ACCOUNTING_MAPPING_INCOMPLETE',
            message: `${label} ${account} cannot be written to ${profile.article} ${name} file. ${profile.textHint}`,
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
          message: `Zero-rate VAT has no approved ${name} Steuercode in this profile version. Exempt, reverse-charge and intra-community treatments are deferred.`,
        };
      }
      const key = profile.steuercodeKeyByRate.get(normalized);
      if (!key) {
        return {
          code: 'UNSUPPORTED_EXPORT_TAX_MODE',
          message: `VAT rate ${normalized}% has no ${name} Steuercode in this profile version.`,
        };
      }
      if (!steuercodes[key]?.trim()) {
        return {
          code: 'ACCOUNTING_MAPPING_INCOMPLETE',
          message: `The ${name} Steuercode for ${normalized}% VAT is not configured.`,
        };
      }
      return null;
    },
  };
}

export function buildRzlAllocationRules(
  steuercodes: RzlSteuercodes,
): AccountingExportAllocationRules {
  return buildAtStandardVatRules('RZL', steuercodes);
}

/** BMD: the RZL rules with BMD tax keys. Text must be printable ASCII (spec A4). */
export function buildBmdAllocationRules(
  steuercodes: BmdSteuercodes,
): AccountingExportAllocationRules {
  return buildAtStandardVatRules('BMD', steuercodes);
}

/** Rules for a profile code and its stored serializer params (null or unknown codes keep DATEV rules). */
export function allocationRulesForProfile(
  profileCode: string | null,
  serializerParams: unknown,
): AccountingExportAllocationRules {
  if (isBmdProfileCode(profileCode)) {
    const { bmd } = parseAccountingProfileSerializerParams(serializerParams);
    return buildBmdAllocationRules(bmd?.steuercodes ?? {});
  }
  if (!isRzlProfileCode(profileCode)) {
    const marginScheme = parseMarginSchemeSerializerParams(serializerParams);
    return marginScheme
      ? buildDatevAllocationRules(marginScheme)
      : DATEV_ALLOCATION_RULES;
  }
  const { rzl } = parseAccountingProfileSerializerParams(serializerParams);
  return buildRzlAllocationRules(rzl?.steuercodes ?? {});
}
