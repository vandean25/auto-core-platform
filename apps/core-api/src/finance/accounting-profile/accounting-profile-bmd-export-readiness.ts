import {
  DEFAULT_BMD_FORMAT_VERSION,
  isBmdProfileCode,
} from './bmd-profile.codes.js';
import type { BmdSerializerParams } from './accounting-profile.serializer-params.js';
import { isBmdSafeText } from './bmd-text-rules.js';

/**
 * Export-only configuration gaps for the BMD profile. As for RZL, these do not
 * feed `computeAccountingProfileReadiness`: that readiness gates invoice
 * issuance, and AT legal entities must not lose issuance over an export setting.
 */
export const BMD_EXPORT_MISSING_FIELDS = {
  STEUERCODE_VAT20: 'steuercode_vat20',
  STEUERCODE_VAT13: 'steuercode_vat13',
  STEUERCODE_VAT10: 'steuercode_vat10',
  FORMAT_VERSION: 'format_version',
  CHART: 'chart',
  ACCOUNT_LENGTH: 'account_length',
  DEFAULT_DEBTOR_ACCOUNT: 'default_debtor_account',
} as const;

export type BmdExportMissingField =
  (typeof BMD_EXPORT_MISSING_FIELDS)[keyof typeof BMD_EXPORT_MISSING_FIELDS];

const BMD_EXPORT_MISSING_FIELD_LABELS: Record<BmdExportMissingField, string> = {
  steuercode_vat20: 'BMD Steuercode for 20% VAT',
  steuercode_vat13: 'BMD Steuercode for 13% VAT',
  steuercode_vat10: 'BMD Steuercode for 10% VAT',
  format_version:
    'pinned BMD format version (save the accounting profile to pin it)',
  chart: 'chart of accounts',
  account_length: 'account length',
  default_debtor_account: 'default debtor account',
};

export function bmdExportMissingFieldLabel(
  field: BmdExportMissingField,
): string {
  return BMD_EXPORT_MISSING_FIELD_LABELS[field];
}

export type BmdExportReadinessInput = {
  profileCode: string | null;
  formatVersion: string | null;
  chart: string | null;
  accountLength: number | null;
  defaultDebtorAccount: string | null;
  serializerParams: BmdSerializerParams;
};

export function computeBmdExportMissingFields(
  input: BmdExportReadinessInput,
): BmdExportMissingField[] {
  if (!isBmdProfileCode(input.profileCode)) {
    return [];
  }

  const missing: BmdExportMissingField[] = [];
  const steuercodes = input.serializerParams.steuercodes ?? {};

  if (!steuercodes.vat20?.trim()) {
    missing.push(BMD_EXPORT_MISSING_FIELDS.STEUERCODE_VAT20);
  }
  if (!steuercodes.vat13?.trim()) {
    missing.push(BMD_EXPORT_MISSING_FIELDS.STEUERCODE_VAT13);
  }
  if (!steuercodes.vat10?.trim()) {
    missing.push(BMD_EXPORT_MISSING_FIELDS.STEUERCODE_VAT10);
  }
  if (input.formatVersion !== DEFAULT_BMD_FORMAT_VERSION) {
    missing.push(BMD_EXPORT_MISSING_FIELDS.FORMAT_VERSION);
  }
  if (!input.chart?.trim()) {
    missing.push(BMD_EXPORT_MISSING_FIELDS.CHART);
  }
  if (
    input.accountLength === null ||
    input.accountLength < 1 ||
    input.accountLength > 8
  ) {
    missing.push(BMD_EXPORT_MISSING_FIELDS.ACCOUNT_LENGTH);
  }
  const debtorAccount = input.defaultDebtorAccount?.trim();
  if (!debtorAccount || !isBmdSafeText(debtorAccount)) {
    missing.push(BMD_EXPORT_MISSING_FIELDS.DEFAULT_DEBTOR_ACCOUNT);
  }

  return missing;
}
