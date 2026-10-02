import { BadRequestException } from '@nestjs/common';
import {
  DEFAULT_AT_PROFILE_CODE,
  DEFAULT_DE_PROFILE_CODE,
  isDatevProfileCode,
  isRzlProfileCode,
} from './accounting-profile.codes.js';

export const DATEV_ACCOUNT_CHARTS = ['SKR03', 'SKR04'] as const;
export const AT_ACCOUNT_CHARTS = ['UGB', 'EA'] as const;

export type DatevAccountChart = (typeof DATEV_ACCOUNT_CHARTS)[number];
export type AtAccountChart = (typeof AT_ACCOUNT_CHARTS)[number];

export function defaultChartForProfileCode(
  profileCode: string | null | undefined,
): string | null {
  if (isDatevProfileCode(profileCode)) {
    return DATEV_ACCOUNT_CHARTS[0];
  }
  if (isRzlProfileCode(profileCode)) {
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
  if (isRzlProfileCode(profileCode)) {
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
      profileCode === DEFAULT_DE_PROFILE_CODE
        ? 'DATEV'
        : profileCode === DEFAULT_AT_PROFILE_CODE
          ? 'RZL'
          : 'accounting export';
    throw new BadRequestException(
      `chart must be one of ${allowed.join(', ')} for ${profileLabel} profiles`,
    );
  }
}
