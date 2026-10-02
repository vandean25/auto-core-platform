import { BadRequestException } from '@nestjs/common';

export type RzlSerializerParams = {
  firmNumber?: string | null;
  costCenterLength?: number | null;
};

export type AccountingProfileSerializerParams = {
  rzl?: RzlSerializerParams;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  };
  return parsed;
}

export function serializeAccountingProfileSerializerParams(
  value: AccountingProfileSerializerParams,
): Record<string, unknown> {
  if (!value.rzl) {
    return {};
  }
  return {
    rzl: {
      firmNumber: value.rzl.firmNumber ?? null,
      costCenterLength: value.rzl.costCenterLength ?? null,
    },
  };
}
