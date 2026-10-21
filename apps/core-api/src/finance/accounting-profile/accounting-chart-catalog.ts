import { BadRequestException } from '@nestjs/common';
import {
  DEFAULT_AT_PROFILE_CODE,
  DEFAULT_DE_PROFILE_CODE,
  isDatevProfileCode,
  isRzlProfileCode,
} from './accounting-profile.codes.js';
import {
  DEFAULT_BMD_AT_PROFILE_CODE,
  isBmdProfileCode,
} from './bmd-profile.codes.js';

export const DATEV_ACCOUNT_CHARTS = ['SKR03', 'SKR04'] as const;
export const AT_ACCOUNT_CHARTS = ['UGB', 'EA'] as const;

const PROFILE_LABELS: ReadonlyMap<string, string> = new Map([
  [DEFAULT_DE_PROFILE_CODE, 'DATEV'],
  [DEFAULT_AT_PROFILE_CODE, 'RZL'],
  [DEFAULT_BMD_AT_PROFILE_CODE, 'BMD'],
]);

function isAtProfileCode(profileCode: string | null | undefined): boolean {
  return isRzlProfileCode(profileCode) || isBmdProfileCode(profileCode);
}

export function defaultChartForProfileCode(
  profileCode: string | null | undefined,
): string | null {
  if (isDatevProfileCode(profileCode)) {
    return DATEV_ACCOUNT_CHARTS[0];
  }
  if (isAtProfileCode(profileCode)) {
    return AT_ACCOUNT_CHARTS[0];
  }
  return null;
}

export function allowedChartsForProfileCode(
  profileCode: string | null | undefined,
): readonly string[] | null {
  if (isDatevProfileCode(profileCode)) {
    return DATEV_ACCOUNT_CHARTS;
  }
  if (isAtProfileCode(profileCode)) {
    return AT_ACCOUNT_CHARTS;
  }
  return null;
}

export function assertChartAllowedForProfile(
  profileCode: string | null | undefined,
  chart: string | null,
): void {
  if (!chart) {
    return;
  }

  const allowed = allowedChartsForProfileCode(profileCode);
  if (!allowed) {
    return;
  }

  if (!allowed.includes(chart)) {
    const profileLabel =
      PROFILE_LABELS.get(profileCode ?? '') ?? 'accounting export';
    throw new BadRequestException(
      `chart must be one of ${allowed.join(', ')} for ${profileLabel} profiles`,
    );
  }
}
