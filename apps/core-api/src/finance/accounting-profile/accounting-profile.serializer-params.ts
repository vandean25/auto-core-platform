import { BadRequestException } from '@nestjs/common';

/** Steuercode per standard Austrian VAT rate. Values are configured per legal entity, never defaulted. */
export type SteuercodesByRate = {
  vat20?: string | null;
  vat13?: string | null;
  vat10?: string | null;
};

/** RZL Steuercode per standard Austrian VAT rate. */
export type RzlSteuercodes = SteuercodesByRate;

/** BMD tax key (defined per BMD client) per standard Austrian VAT rate. */
export type BmdSteuercodes = SteuercodesByRate;

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

export type BmdSerializerParams = {
  steuercodes?: BmdSteuercodes;
};

export type AccountingProfileSerializerParams = {
  rzl?: RzlSerializerParams;
  bmd?: BmdSerializerParams;
  marginScheme?: MarginSchemeSerializerParams;
};

/** Request-side shape before parsing: a PATCH may send only some margin fields. */
export type AccountingProfileSerializerParamsInput = {
  rzl?: RzlSerializerParams | null;
  bmd?: BmdSerializerParams | null;
  marginScheme?: Partial<MarginSchemeSerializerParams> | null;
};

const STEUERCODE_PATTERN = /^[0-9]{1,4}$/;
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

function parseSteuercodeValue(raw: unknown, path: string): string | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  if (typeof raw !== 'string') {
    throw new BadRequestException(`${path} must be a string`);
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (!STEUERCODE_PATTERN.test(trimmed)) {
    throw new BadRequestException(`${path} must be 1 to 4 digits`);
  }
  return trimmed;
}

function parseSteuercodes(
  value: unknown,
  path: string,
): Required<SteuercodesByRate> {
  if (value === undefined || value === null) {
    return { vat20: null, vat13: null, vat10: null };
  }
  if (!isPlainObject(value)) {
    throw new BadRequestException(`${path} must be an object`);
  }
  return {
    vat20: parseSteuercodeValue(value.vat20, `${path}.vat20`),
    vat13: parseSteuercodeValue(value.vat13, `${path}.vat13`),
    vat10: parseSteuercodeValue(value.vat10, `${path}.vat10`),
  };
}

function assertFirmNumberLength(firmNumber: string | null): void {
  if (firmNumber && firmNumber.length > 32) {
    throw new BadRequestException(
      'serializerParams.rzl.firmNumber must be at most 32 characters',
    );
  }
}

function assertCostCenterLength(costCenterLength: number | null): void {
  if (
    costCenterLength !== null &&
    (costCenterLength < 1 || costCenterLength > 16)
  ) {
    throw new BadRequestException(
      'serializerParams.rzl.costCenterLength must be between 1 and 16',
    );
  }
}

function parseRzlSerializerParams(value: unknown): RzlSerializerParams {
  if (!isPlainObject(value)) {
    throw new BadRequestException('serializerParams.rzl must be an object');
  }

  const firmNumber =
    typeof value.firmNumber === 'string' ? value.firmNumber.trim() : null;
  const costCenterLength =
    typeof value.costCenterLength === 'number' ? value.costCenterLength : null;
  assertFirmNumberLength(firmNumber);
  assertCostCenterLength(costCenterLength);

  return {
    firmNumber: firmNumber || null,
    costCenterLength,
    steuercodes: parseSteuercodes(
      value.steuercodes,
      'serializerParams.rzl.steuercodes',
    ),
  };
}

function parseBmdSerializerParams(value: unknown): BmdSerializerParams {
  if (!isPlainObject(value)) {
    throw new BadRequestException('serializerParams.bmd must be an object');
  }

  return {
    steuercodes: parseSteuercodes(
      value.steuercodes,
      'serializerParams.bmd.steuercodes',
    ),
  };
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
  if (value.rzl !== undefined && value.rzl !== null) {
    parsed.rzl = parseRzlSerializerParams(value.rzl);
  }
  if (value.bmd !== undefined && value.bmd !== null) {
    parsed.bmd = parseBmdSerializerParams(value.bmd);
  }
  return parsed;
}

/**
 * Reads only the margin switch. The DATEV export checks the switch and must not fail
 * on RZL or BMD blocks it never uses, so those blocks are not parsed here.
 */
export function parseMarginSchemeSerializerParams(
  value: unknown,
): MarginSchemeSerializerParams | null {
  if (
    !isPlainObject(value) ||
    value.marginScheme === undefined ||
    value.marginScheme === null
  ) {
    return null;
  }
  return parseMarginScheme(value.marginScheme);
}

export function serializeAccountingProfileSerializerParams(
  value: AccountingProfileSerializerParams,
): Record<string, unknown> {
  const serialized: Record<string, unknown> = {};
  if (value.rzl) {
    serialized.rzl = {
      firmNumber: value.rzl.firmNumber ?? null,
      costCenterLength: value.rzl.costCenterLength ?? null,
      steuercodes: parseSteuercodes(
        value.rzl.steuercodes,
        'serializerParams.rzl.steuercodes',
      ),
    };
  }
  if (value.bmd) {
    serialized.bmd = {
      steuercodes: parseSteuercodes(
        value.bmd.steuercodes,
        'serializerParams.bmd.steuercodes',
      ),
    };
  }
  // Default-off margin settings are not written, so default profiles keep their stored JSON.
  if (value.marginScheme?.enabled || value.marginScheme?.vatAccount) {
    serialized.marginScheme = {
      enabled: value.marginScheme.enabled,
      vatAccount: value.marginScheme.vatAccount ?? null,
    };
  }
  return serialized;
}

/**
 * A profile PATCH replaces the RZL, BMD and margin blocks it carries. An omitted
 * block keeps the stored one, and an explicit `null` clears it. Inside the margin
 * block, omitted fields keep their stored value. A RZL-only save must not switch
 * the margin scheme off, and a VAT-account-only patch must not disable it.
 */
export function mergeAccountingProfileSerializerParams(
  stored: unknown,
  patch: AccountingProfileSerializerParamsInput,
): AccountingProfileSerializerParams {
  const current = parseAccountingProfileSerializerParams(stored);
  const { bmd: patchBmd, marginScheme: patchMargin, rzl: patchRzl } = patch;
  const merged: Record<string, unknown> = {
    rzl: patchRzl === undefined ? current.rzl : patchRzl,
    bmd: patchBmd === undefined ? current.bmd : patchBmd,
  };
  if (
    patchMargin !== null &&
    (patchMargin !== undefined || current.marginScheme !== undefined)
  ) {
    merged.marginScheme = {
      enabled: patchMargin?.enabled ?? current.marginScheme?.enabled ?? false,
      vatAccount:
        patchMargin?.vatAccount !== undefined
          ? patchMargin.vatAccount
          : (current.marginScheme?.vatAccount ?? null),
    };
  }
  return parseAccountingProfileSerializerParams(merged);
}
