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

export type AccountingProfileSerializerParams = {
  rzl?: RzlSerializerParams;
};

const STEUERCODE_PATTERN = /^[0-9]{1,4}$/;
const STEUERCODE_KEYS = ['vat20', 'vat13', 'vat10'] as const;

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
  if (!value.rzl) {
    return {};
  }
  const steuercodes = parseSteuercodes(value.rzl.steuercodes);
  return {
    rzl: {
      firmNumber: value.rzl.firmNumber ?? null,
      costCenterLength: value.rzl.costCenterLength ?? null,
      steuercodes: {
        vat20: steuercodes.vat20,
        vat13: steuercodes.vat13,
        vat10: steuercodes.vat10,
      },
    },
  };
}
