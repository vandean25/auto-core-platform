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

export type BmdSerializerParams = {
  steuercodes?: BmdSteuercodes;
};

export type AccountingProfileSerializerParams = {
  rzl?: RzlSerializerParams;
  bmd?: BmdSerializerParams;
};

const STEUERCODE_PATTERN = /^[0-9]{1,4}$/;

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
  if (value.rzl !== undefined && value.rzl !== null) {
    parsed.rzl = parseRzlSerializerParams(value.rzl);
  }
  if (value.bmd !== undefined && value.bmd !== null) {
    parsed.bmd = parseBmdSerializerParams(value.bmd);
  }
  return parsed;
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
  return serialized;
}
