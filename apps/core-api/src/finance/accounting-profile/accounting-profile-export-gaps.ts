import { isRzlProfileCode } from './accounting-profile.codes.js';
import {
  bmdExportMissingFieldLabel,
  computeBmdExportMissingFields,
  type BmdExportMissingField,
} from './accounting-profile-bmd-export-readiness.js';
import {
  computeRzlExportMissingFields,
  rzlExportMissingFieldLabel,
  type RzlExportMissingField,
} from './accounting-profile-export-readiness.js';
import type { AccountingProfileSerializerParams } from './accounting-profile.serializer-params.js';
import { isBmdProfileCode } from './bmd-profile.codes.js';

/** Profiles with export-only configuration gaps. DATEV has none. */
export type ExportGapProfileName = 'RZL' | 'BMD';

export type ExportGapInput = {
  profileCode: string | null;
  formatVersion: string | null;
  chart: string | null;
  accountLength: number | null;
  defaultDebtorAccount: string | null;
  serializerParams: AccountingProfileSerializerParams;
};

export function exportGapProfileName(
  profileCode: string | null | undefined,
): ExportGapProfileName | null {
  if (isRzlProfileCode(profileCode)) {
    return 'RZL';
  }
  if (isBmdProfileCode(profileCode)) {
    return 'BMD';
  }
  return null;
}

/** Export-only gaps of a profile, in the field order of its own readiness rules. */
export function computeExportGapFields(input: ExportGapInput): string[] {
  const common = {
    profileCode: input.profileCode,
    formatVersion: input.formatVersion,
    chart: input.chart,
    accountLength: input.accountLength,
    defaultDebtorAccount: input.defaultDebtorAccount,
  };
  if (isBmdProfileCode(input.profileCode)) {
    return computeBmdExportMissingFields({
      ...common,
      serializerParams: input.serializerParams.bmd ?? {},
    });
  }
  return computeRzlExportMissingFields({
    ...common,
    serializerParams: input.serializerParams.rzl ?? {},
  });
}

export function exportGapLabel(
  profileName: ExportGapProfileName,
  field: string,
): string {
  return profileName === 'BMD'
    ? bmdExportMissingFieldLabel(field as BmdExportMissingField)
    : rzlExportMissingFieldLabel(field as RzlExportMissingField);
}
