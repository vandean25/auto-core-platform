import { BadRequestException } from '@nestjs/common';

export const VEHICLE_NOVA_CLASS_VALUES = [
  'NOT_SET',
  'STANDARD',
  'ELECTRIC_EXEMPT',
  'OTHER',
] as const;

export type VehicleNovaClass = (typeof VEHICLE_NOVA_CLASS_VALUES)[number];

export const VEHICLE_FIRST_REGISTRATION_DATE_INVALID_CODE =
  'VEHICLE_FIRST_REGISTRATION_DATE_INVALID';
export const VEHICLE_FIRST_REGISTRATION_DATE_FUTURE_CODE =
  'VEHICLE_FIRST_REGISTRATION_DATE_FUTURE';
export const VEHICLE_CO2_WLTP_OUT_OF_RANGE_CODE =
  'VEHICLE_CO2_WLTP_OUT_OF_RANGE';
export const VEHICLE_CO2_NEDC_OUT_OF_RANGE_CODE =
  'VEHICLE_CO2_NEDC_OUT_OF_RANGE';
export const VEHICLE_NOVA_CLASS_INVALID_CODE = 'VEHICLE_NOVA_CLASS_INVALID';

const CO2_MIN = 0;
const CO2_MAX = 600;
const VIENNA_TIME_ZONE = 'Europe/Vienna';
const DATE_ONLY_OR_ISO_DATETIME =
  /^(\d{4}-\d{2}-\d{2})(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

export type VehicleRegulatoryInput = {
  first_registration_date?: string | Date | null;
  co2_wltp_g_km?: number | null;
  co2_nedc_g_km?: number | null;
  typenschein_no?: string | null;
  nova_class?: string | null;
  emission_class?: string | null;
};

export function normalizeOptionalTrimmedString(
  value: string | undefined | null,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function normalizeNovaClass(
  value: string | undefined | null,
): string | null | undefined {
  const normalized = normalizeOptionalTrimmedString(value);
  if (normalized === undefined || normalized === null) {
    return normalized;
  }
  return normalized.toUpperCase();
}

function toDateOnlyInput(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value !== 'string') {
    throw new BadRequestException({
      code: VEHICLE_FIRST_REGISTRATION_DATE_INVALID_CODE,
      message: 'first_registration_date must be a valid ISO date (YYYY-MM-DD)',
      field: 'first_registration_date',
    });
  }
  const trimmed = value.trim();
  const match = DATE_ONLY_OR_ISO_DATETIME.exec(trimmed);
  return match ? match[1] : trimmed;
}

function parseDateOnlyUtc(value: unknown): Date {
  const dateOnly = toDateOnlyInput(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly);
  if (!match) {
    throw new BadRequestException({
      code: VEHICLE_FIRST_REGISTRATION_DATE_INVALID_CODE,
      message: 'first_registration_date must be a valid ISO date (YYYY-MM-DD)',
      field: 'first_registration_date',
    });
  }
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new BadRequestException({
      code: VEHICLE_FIRST_REGISTRATION_DATE_INVALID_CODE,
      message: 'first_registration_date must be a valid ISO date (YYYY-MM-DD)',
      field: 'first_registration_date',
    });
  }
  return parsed;
}

function todayInViennaYmd(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: VIENNA_TIME_ZONE,
  }).format(new Date());
}

function assertCo2InRange(
  value: number | null | undefined,
  field: 'co2_wltp_g_km' | 'co2_nedc_g_km',
  code: string,
): void {
  if (value === undefined || value === null) {
    return;
  }
  if (!Number.isInteger(value) || value < CO2_MIN || value > CO2_MAX) {
    throw new BadRequestException({
      code,
      message: `${field} must be an integer between ${CO2_MIN} and ${CO2_MAX}`,
      field,
    });
  }
}

export function assertVehicleRegulatoryFields(
  input: VehicleRegulatoryInput,
): void {
  if (input.first_registration_date !== undefined) {
    if (input.first_registration_date === null) {
      // cleared
    } else {
      const parsed = parseDateOnlyUtc(input.first_registration_date);
      const parsedYmd = parsed.toISOString().slice(0, 10);
      if (parsedYmd > todayInViennaYmd()) {
        throw new BadRequestException({
          code: VEHICLE_FIRST_REGISTRATION_DATE_FUTURE_CODE,
          message: 'first_registration_date cannot be in the future',
          field: 'first_registration_date',
        });
      }
    }
  }

  assertCo2InRange(
    input.co2_wltp_g_km,
    'co2_wltp_g_km',
    VEHICLE_CO2_WLTP_OUT_OF_RANGE_CODE,
  );
  assertCo2InRange(
    input.co2_nedc_g_km,
    'co2_nedc_g_km',
    VEHICLE_CO2_NEDC_OUT_OF_RANGE_CODE,
  );

  if (input.nova_class !== undefined && input.nova_class !== null) {
    const normalized = input.nova_class.trim().toUpperCase();
    if (!VEHICLE_NOVA_CLASS_VALUES.includes(normalized as VehicleNovaClass)) {
      throw new BadRequestException({
        code: VEHICLE_NOVA_CLASS_INVALID_CODE,
        message: `nova_class must be one of: ${VEHICLE_NOVA_CLASS_VALUES.join(', ')}`,
        field: 'nova_class',
      });
    }
  }
}

export function normalizeVehicleRegulatoryFields<
  T extends VehicleRegulatoryInput,
>(input: T): T {
  return {
    ...input,
    ...(input.typenschein_no !== undefined
      ? { typenschein_no: normalizeOptionalTrimmedString(input.typenschein_no) }
      : {}),
    ...(input.emission_class !== undefined
      ? {
          emission_class: normalizeOptionalTrimmedString(input.emission_class),
        }
      : {}),
    ...(input.nova_class !== undefined
      ? { nova_class: normalizeNovaClass(input.nova_class) }
      : {}),
    ...(input.first_registration_date !== undefined &&
    input.first_registration_date !== null &&
    typeof input.first_registration_date === 'string'
      ? {
          first_registration_date: parseDateOnlyUtc(
            input.first_registration_date,
          ),
        }
      : {}),
  };
}
