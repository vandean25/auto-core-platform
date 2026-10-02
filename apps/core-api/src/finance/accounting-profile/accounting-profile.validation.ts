import { BadRequestException } from '@nestjs/common';
import { assertChartAllowedForProfile } from './accounting-chart-catalog.js';
import {
  isDatevProfileCode,
  isExportSerializerImplemented,
} from './accounting-profile.codes.js';
import {
  parseAccountingProfileSerializerParams,
  serializeAccountingProfileSerializerParams,
  type AccountingProfileSerializerParams,
} from './accounting-profile.serializer-params.js';
import { type AccountingMappingRule } from './accounting-profile.types.js';

export function normalizeOptionalString(
  value: string | undefined | null,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function requireStringField(
  value: unknown,
  field: string,
  index: number,
): string {
  if (typeof value !== 'string') {
    throw new BadRequestException(
      `mappingRules[${index}].${field} must be a string`,
    );
  }
  return value;
}

function assertMaxLength(
  field: string,
  value: string | null,
  maxLength: number,
): void {
  if (value !== null && value.length > maxLength) {
    throw new BadRequestException(
      `${field} must be at most ${maxLength} characters`,
    );
  }
}

function parseMappingRules(value: unknown): AccountingMappingRule[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException('mappingRules must be an array');
  }

  const parsedRules: AccountingMappingRule[] = [];

  for (const [index, entry] of value.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      throw new BadRequestException(`mappingRules[${index}] must be an object`);
    }

    const rule = entry as Record<string, unknown>;
    const taxTreatment = rule.taxTreatment;
    if (taxTreatment !== 'automatic' && taxTreatment !== 'manual_bu') {
      throw new BadRequestException(
        `mappingRules[${index}].taxTreatment must be automatic or manual_bu`,
      );
    }

    const taxMode = rule.taxMode;
    if (taxMode !== 'STANDARD' && taxMode !== 'MARGIN_SCHEME') {
      throw new BadRequestException(
        `mappingRules[${index}].taxMode must be STANDARD or MARGIN_SCHEME`,
      );
    }

    const revenueAccount = normalizeOptionalString(
      typeof rule.revenueAccount === 'string' ? rule.revenueAccount : null,
    );
    if (!revenueAccount) {
      continue;
    }

    const buKey = normalizeOptionalString(
      typeof rule.buKey === 'string' ? rule.buKey : null,
    );
    if (taxTreatment === 'manual_bu' && !buKey) {
      throw new BadRequestException(
        `mappingRules[${index}].buKey is required for manual_bu tax treatment`,
      );
    }
    if (taxTreatment === 'automatic' && buKey) {
      throw new BadRequestException(
        `mappingRules[${index}] cannot set buKey when taxTreatment is automatic`,
      );
    }

    parsedRules.push({
      sourceCategoryKey: requireStringField(
        rule.sourceCategoryKey,
        'sourceCategoryKey',
        index,
      ),
      sourceCategoryLabel: requireStringField(
        rule.sourceCategoryLabel,
        'sourceCategoryLabel',
        index,
      ),
      taxMode,
      taxRate: requireStringField(rule.taxRate, 'taxRate', index),
      revenueAccount,
      taxTreatment,
      buKey: taxTreatment === 'manual_bu' ? buKey : null,
    });
  }

  return parsedRules;
}

export type AccountingProfilePatchInput = {
  profileCode?: string | null;
  formatVersion?: string | null;
  chart?: string | null;
  accountLength?: number | null;
  advisorNumber?: string | null;
  clientNumber?: string | null;
  fiscalYearStartMonth?: number | null;
  defaultDebtorAccount?: string | null;
  mappingRules?: AccountingMappingRule[];
  serializerParams?: AccountingProfileSerializerParams;
  isEnabled?: boolean;
};

export type AccountingProfileValidationContext = {
  countryIso: 'AT' | 'DE';
  currentProfileCode: string | null;
  currentChart: string | null;
};

function resolveProfileCodeAfterPatch(
  patch: AccountingProfilePatchInput,
  context: AccountingProfileValidationContext,
): string | null {
  if (patch.profileCode !== undefined) {
    return normalizeOptionalString(patch.profileCode);
  }
  return context.currentProfileCode;
}

export function validateAccountingProfilePatch(
  patch: AccountingProfilePatchInput,
  context: AccountingProfileValidationContext,
): AccountingProfilePatchInput {
  const countryIso = context.countryIso;
  const normalized: AccountingProfilePatchInput = {};

  if (patch.profileCode !== undefined) {
    normalized.profileCode = normalizeOptionalString(patch.profileCode);
  }
  if (patch.formatVersion !== undefined) {
    normalized.formatVersion = normalizeOptionalString(patch.formatVersion);
  }
  if (patch.chart !== undefined) {
    normalized.chart = normalizeOptionalString(patch.chart);
  }
  if (patch.advisorNumber !== undefined) {
    normalized.advisorNumber = normalizeOptionalString(patch.advisorNumber);
  }
  if (patch.clientNumber !== undefined) {
    normalized.clientNumber = normalizeOptionalString(patch.clientNumber);
  }
  if (patch.defaultDebtorAccount !== undefined) {
    normalized.defaultDebtorAccount = normalizeOptionalString(
      patch.defaultDebtorAccount,
    );
  }

  if (patch.accountLength !== undefined) {
    if (
      patch.accountLength !== null &&
      (patch.accountLength < 1 || patch.accountLength > 8)
    ) {
      throw new BadRequestException(
        'accountLength must be between 1 and 8 when provided',
      );
    }
    normalized.accountLength = patch.accountLength;
  }

  if (patch.fiscalYearStartMonth !== undefined) {
    if (
      patch.fiscalYearStartMonth !== null &&
      (patch.fiscalYearStartMonth < 1 || patch.fiscalYearStartMonth > 12)
    ) {
      throw new BadRequestException(
        'fiscalYearStartMonth must be between 1 and 12 when provided',
      );
    }
    normalized.fiscalYearStartMonth = patch.fiscalYearStartMonth;
  }

  if (patch.mappingRules !== undefined) {
    normalized.mappingRules = parseMappingRules(patch.mappingRules);
  }

  if (patch.serializerParams !== undefined) {
    normalized.serializerParams = parseAccountingProfileSerializerParams(
      patch.serializerParams,
    );
  }

  const effectiveProfileCode = resolveProfileCodeAfterPatch(patch, context);
  const effectiveChart =
    patch.chart !== undefined
      ? (normalized.chart ?? null)
      : context.currentChart;

  const chartChanged = effectiveChart !== context.currentChart;
  const profileCodeChanged =
    effectiveProfileCode !== context.currentProfileCode;
  if (chartChanged || profileCodeChanged) {
    assertChartAllowedForProfile(effectiveProfileCode, effectiveChart);
  }

  if (
    profileCodeChanged &&
    !isExportSerializerImplemented(effectiveProfileCode) &&
    patch.isEnabled === undefined
  ) {
    normalized.isEnabled = false;
  }

  if (patch.isEnabled !== undefined) {
    if (patch.isEnabled) {
      if (!isExportSerializerImplemented(effectiveProfileCode)) {
        throw new BadRequestException(
          'Accounting export profile cannot be enabled until the serializer is approved and implemented.',
        );
      }
      if (isDatevProfileCode(effectiveProfileCode) && countryIso !== 'DE') {
        throw new BadRequestException(
          'DATEV export profile can only be enabled for DE legal entities',
        );
      }
    }
    normalized.isEnabled = patch.isEnabled;
  }

  assertMaxLength('profileCode', normalized.profileCode ?? null, 64);
  assertMaxLength('formatVersion', normalized.formatVersion ?? null, 64);
  assertMaxLength('chart', normalized.chart ?? null, 32);
  assertMaxLength('advisorNumber', normalized.advisorNumber ?? null, 32);
  assertMaxLength('clientNumber', normalized.clientNumber ?? null, 32);
  assertMaxLength(
    'defaultDebtorAccount',
    normalized.defaultDebtorAccount ?? null,
    16,
  );

  return normalized;
}
