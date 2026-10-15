import type { Prisma } from '@prisma/client';
import type { ApplyRegistrationIntakeDto } from './dto/apply-registration-intake.dto.js';
import { registrationFieldConflict } from './registration-intake.errors.js';

type VehicleRegulatoryRow = {
  national_code: string | null;
  first_registration_date: Date | null;
  co2_wltp_g_km: number | null;
  co2_nedc_g_km: number | null;
};

export function assertStoredRegulatoryFieldsMatchConfirmation(
  vehicle: VehicleRegulatoryRow,
  dto: ApplyRegistrationIntakeDto,
): void {
  if (
    dto.nationalcode &&
    vehicle.national_code &&
    vehicle.national_code !== dto.nationalcode
  ) {
    throw registrationFieldConflict();
  }
  if (dto.firstRegistration && vehicle.first_registration_date) {
    const stored = vehicle.first_registration_date.toISOString().slice(0, 10);
    if (stored !== dto.firstRegistration) {
      throw registrationFieldConflict();
    }
  }
  if (dto.co2) {
    if (
      dto.co2.cycle === 'WLTP' &&
      vehicle.co2_wltp_g_km !== null &&
      vehicle.co2_wltp_g_km !== dto.co2.value
    ) {
      throw registrationFieldConflict();
    }
    if (
      dto.co2.cycle === 'NEDC' &&
      vehicle.co2_nedc_g_km !== null &&
      vehicle.co2_nedc_g_km !== dto.co2.value
    ) {
      throw registrationFieldConflict();
    }
  }
}

export function buildFillBlankRegulatoryUpdate(
  vehicle: VehicleRegulatoryRow,
  dto: ApplyRegistrationIntakeDto,
): Prisma.VehicleUpdateInput {
  const data: Prisma.VehicleUpdateInput = {};
  if (!vehicle.national_code && dto.nationalcode) {
    data.national_code = dto.nationalcode;
  }
  if (!vehicle.first_registration_date && dto.firstRegistration) {
    data.first_registration_date = new Date(dto.firstRegistration);
  }
  if (dto.co2) {
    if (dto.co2.cycle === 'WLTP' && vehicle.co2_wltp_g_km === null) {
      data.co2_wltp_g_km = dto.co2.value;
    }
    if (dto.co2.cycle === 'NEDC' && vehicle.co2_nedc_g_km === null) {
      data.co2_nedc_g_km = dto.co2.value;
    }
  }
  return data;
}
