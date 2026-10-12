import {
  DEFAULT_RZL_FORMAT_VERSION,
  isRzlProfileCode,
} from './accounting-profile.codes.js';
import type { RzlSerializerParams } from './accounting-profile.serializer-params.js';

/**
 * Export-only configuration gaps for the RZL profile. These deliberately do not
 * feed `computeAccountingProfileReadiness`: that readiness gates invoice
 * issuance, and AT legal entities already default to the RZL profile code.
 */
export const RZL_EXPORT_MISSING_FIELDS = {
  FIRM_NUMBER: 'firm_number',
  STEUERCODE_VAT20: 'steuercode_vat20',
  STEUERCODE_VAT13: 'steuercode_vat13',
  STEUERCODE_VAT10: 'steuercode_vat10',
  FORMAT_VERSION: 'format_version',
  CHART: 'chart',
  ACCOUNT_LENGTH: 'account_length',
  DEFAULT_DEBTOR_ACCOUNT: 'default_debtor_account',
} as const;

export type RzlExportMissingField =
  (typeof RZL_EXPORT_MISSING_FIELDS)[keyof typeof RZL_EXPORT_MISSING_FIELDS];

const RZL_EXPORT_MISSING_FIELD_LABELS: Record<RzlExportMissingField, string> = {
  firm_number: 'firm number (Firmennummer)',
  steuercode_vat20: 'Steuercode for 20% VAT',
  steuercode_vat13: 'Steuercode for 13% VAT',
  steuercode_vat10: 'Steuercode for 10% VAT',
  format_version:
    'pinned RZL format version (save the accounting profile to pin it)',
  chart: 'chart of accounts',
  account_length: 'account length',
  default_debtor_account: 'default debtor account',
};

export function rzlExportMissingFieldLabel(
  field: RzlExportMissingField,
): string {
  return RZL_EXPORT_MISSING_FIELD_LABELS[field];
}

export type RzlExportReadinessInput = {
  profileCode: string | null;
  formatVersion: string | null;
  chart: string | null;
  accountLength: number | null;
  defaultDebtorAccount: string | null;
  serializerParams: RzlSerializerParams;
};

export function computeRzlExportMissingFields(
  input: RzlExportReadinessInput,
): RzlExportMissingField[] {
  if (!isRzlProfileCode(input.profileCode)) {
    return [];
  }

  const missing: RzlExportMissingField[] = [];
  const steuercodes = input.serializerParams.steuercodes ?? {};

  if (!input.serializerParams.firmNumber?.trim()) {
    missing.push(RZL_EXPORT_MISSING_FIELDS.FIRM_NUMBER);
  }
  if (!steuercodes.vat20?.trim()) {
    missing.push(RZL_EXPORT_MISSING_FIELDS.STEUERCODE_VAT20);
  }
  if (!steuercodes.vat13?.trim()) {
    missing.push(RZL_EXPORT_MISSING_FIELDS.STEUERCODE_VAT13);
  }
  if (!steuercodes.vat10?.trim()) {
    missing.push(RZL_EXPORT_MISSING_FIELDS.STEUERCODE_VAT10);
  }
  if (input.formatVersion !== DEFAULT_RZL_FORMAT_VERSION) {
    missing.push(RZL_EXPORT_MISSING_FIELDS.FORMAT_VERSION);
  }
  if (!input.chart?.trim()) {
    missing.push(RZL_EXPORT_MISSING_FIELDS.CHART);
  }
  if (input.accountLength === null || input.accountLength < 1) {
    missing.push(RZL_EXPORT_MISSING_FIELDS.ACCOUNT_LENGTH);
  }
  if (!input.defaultDebtorAccount?.trim()) {
    missing.push(RZL_EXPORT_MISSING_FIELDS.DEFAULT_DEBTOR_ACCOUNT);
  }

  return missing;
}
