import { BadRequestException } from '@nestjs/common';

/** RZL Steuercode per standard Austrian VAT rate. Values are configured per legal entity, never defaulted. */
export type RzlSteuercodes = {
  vat20?: string | null;
  vat13?: string | null;
  vat10?: string | null;
};

export type RzlSerializerParams = {
  firmNumber?: string | null;
  costCenterLength?: number | null;
  steuercodes?: RzlSteuercodes;
};

/**
 * Per-entity switch that lifts the margin-scheme export block (AUT-369). Off by
 * default. The VAT account receives the frozen margin VAT; it is configured by
 * the entity admin, never defaulted.
 */
export type MarginSchemeSerializerParams = {
  enabled: boolean;
  vatAccount: string | null;
};

export type AccountingProfileSerializerParams = {
  rzl?: RzlSerializerParams;
  marginScheme?: MarginSchemeSerializerParams;
};

/** Request-side shape before parsing: a PATCH may send only some margin fields. */
export type AccountingProfileSerializerParamsInput = {
  rzl?: RzlSerializerParams;
  marginScheme?: Partial<MarginSchemeSerializerParams>;
};

const STEUERCODE_PATTERN = /^[0-9]{1,4}$/;
const STEUERCODE_KEYS = ['vat20', 'vat13', 'vat10'] as const;
const MARGIN_VAT_ACCOUNT_PATTERN = /^[0-9]{1,9}$/;

function parseMarginScheme(value: unknown): MarginSchemeSerializerParams {
  if (!isPlainObject(value)) {
    throw new BadRequestException(
      'serializerParams.marginScheme must be an object',
    );
  }
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
    throw new BadRequestException(
      'serializerParams.marginScheme.enabled must be a boolean',
    );
  }
  if (
    value.vatAccount !== undefined &&
    value.vatAccount !== null &&
    typeof value.vatAccount !== 'string'
  ) {
    throw new BadRequestException(
      'serializerParams.marginScheme.vatAccount must be a string',
    );
  }

  const enabled = value.enabled === true;
  const vatAccount =
    typeof value.vatAccount === 'string' ? value.vatAccount.trim() : '';
  if (enabled && vatAccount.length === 0) {
    throw new BadRequestException(
      'serializerParams.marginScheme.vatAccount is required when margin export is enabled',
    );
  }
  if (vatAccount.length > 0 && !MARGIN_VAT_ACCOUNT_PATTERN.test(vatAccount)) {
    throw new BadRequestException(
      'serializerParams.marginScheme.vatAccount must be 1 to 9 digits',
    );
  }
  return { enabled, vatAccount: vatAccount || null };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSteuercodes(value: unknown): Required<RzlSteuercodes> {
  if (value === undefined || value === null) {
    return { vat20: null, vat13: null, vat10: null };
  }
  if (!isPlainObject(value)) {
    throw new BadRequestException(
      'serializerParams.rzl.steuercodes must be an object',
    );
  }

  const parsed: Required<RzlSteuercodes> = {
    vat20: null,
    vat13: null,
    vat10: null,
  };
  for (const key of STEUERCODE_KEYS) {
    const raw = value[key];
    if (raw === undefined || raw === null) {
      continue;
    }
    if (typeof raw !== 'string') {
      throw new BadRequestException(
        `serializerParams.rzl.steuercodes.${key} must be a string`,
      );
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (!STEUERCODE_PATTERN.test(trimmed)) {
      throw new BadRequestException(
        `serializerParams.rzl.steuercodes.${key} must be 1 to 4 digits`,
      );
    }
    parsed[key] = trimmed;
  }
  return parsed;
}

export function parseAccountingProfileSerializerParams(
  value: unknown,
): AccountingProfileSerializerParams {
  if (value === undefined || value === null) {
    return {};
  }
  if (!isPlainObject(value)) {
    throw new BadRequestException('serializerParams must be an object');
  }

  const parsed: AccountingProfileSerializerParams = {};
  if (value.marginScheme !== undefined && value.marginScheme !== null) {
    parsed.marginScheme = parseMarginScheme(value.marginScheme);
  }
  const rzl = value.rzl;
  if (rzl === undefined || rzl === null) {
    return parsed;
  }
  if (!isPlainObject(rzl)) {
    throw new BadRequestException('serializerParams.rzl must be an object');
  }

  const firmNumber =
    typeof rzl.firmNumber === 'string' ? rzl.firmNumber.trim() : null;
  const costCenterLength =
    typeof rzl.costCenterLength === 'number' ? rzl.costCenterLength : null;

  if (firmNumber && firmNumber.length > 32) {
    throw new BadRequestException(
      'serializerParams.rzl.firmNumber must be at most 32 characters',
    );
  }
  if (
    costCenterLength !== null &&
    (costCenterLength < 1 || costCenterLength > 16)
  ) {
    throw new BadRequestException(
      'serializerParams.rzl.costCenterLength must be between 1 and 16',
    );
  }

  parsed.rzl = {
    firmNumber: firmNumber || null,
    costCenterLength,
    steuercodes: parseSteuercodes(rzl.steuercodes),
  };
  return parsed;
}

export function serializeAccountingProfileSerializerParams(
  value: AccountingProfileSerializerParams,
): Record<string, unknown> {
  const stored: Record<string, unknown> = {};
  if (value.rzl) {
    const steuercodes = parseSteuercodes(value.rzl.steuercodes);
    stored.rzl = {
      firmNumber: value.rzl.firmNumber ?? null,
      costCenterLength: value.rzl.costCenterLength ?? null,
      steuercodes: {
        vat20: steuercodes.vat20,
        vat13: steuercodes.vat13,
        vat10: steuercodes.vat10,
      },
    };
  }
  // Default-off margin settings are not written, so default profiles keep their stored JSON.
  if (value.marginScheme?.enabled || value.marginScheme?.vatAccount) {
    stored.marginScheme = {
      enabled: value.marginScheme.enabled,
      vatAccount: value.marginScheme.vatAccount ?? null,
    };
  }
  return stored;
}

/**
 * A profile PATCH replaces the RZL params it carries, and keeps the stored ones
 * when it carries none. Margin fields it omits keep their stored value too. A
 * RZL-only save must not switch the margin scheme off, and a VAT-account-only
 * patch must not disable it.
 */
export function mergeAccountingProfileSerializerParams(
  stored: unknown,
  patch: AccountingProfileSerializerParamsInput,
): AccountingProfileSerializerParams {
  const current = parseAccountingProfileSerializerParams(stored);
  const { marginScheme: patchMargin, rzl: patchRzl } = patch;
  const hasMargin =
    patchMargin !== undefined || current.marginScheme !== undefined;

  return parseAccountingProfileSerializerParams({
    rzl: patchRzl ?? current.rzl,
    ...(hasMargin
      ? {
          marginScheme: {
            enabled:
              patchMargin?.enabled ?? current.marginScheme?.enabled ?? false,
            vatAccount:
              patchMargin?.vatAccount !== undefined
                ? patchMargin.vatAccount
                : (current.marginScheme?.vatAccount ?? null),
          },
        }
      : {}),
  });
}
