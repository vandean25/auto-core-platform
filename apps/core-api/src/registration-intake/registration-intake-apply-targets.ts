import type { RegistrationMatchSnapshot } from './registration-document-extraction.types.js';
import type { ApplyRegistrationIntakeDto } from './dto/apply-registration-intake.dto.js';
import { registrationConfirmationMismatch } from './registration-intake.errors.js';

export type ResolvedApplyTargets = {
  customerId?: string;
  vehicleId: string | null;
  createCustomer: boolean;
  createVehicle: boolean;
};

export function resolveApplyTargets(
  snapshot: RegistrationMatchSnapshot | null,
  dto: ApplyRegistrationIntakeDto,
  cases: string[],
): ResolvedApplyTargets {
  const customers = snapshot?.customers ?? [];
  const vehicles = snapshot?.vehicles ?? [];

  let customerId = dto.customerId;
  if (cases.includes('DUPLICATE_CUSTOMERS')) {
    if (!customerId || !customers.some((c) => c.id === customerId)) {
      throw registrationConfirmationMismatch();
    }
  } else if (cases.includes('EXISTING_CUSTOMER')) {
    const matchedId = customers[0]?.id;
    if (!matchedId) {
      throw registrationConfirmationMismatch();
    }
    if (customerId && customerId !== matchedId) {
      throw registrationConfirmationMismatch();
    }
    customerId = matchedId;
  } else if (customerId) {
    throw registrationConfirmationMismatch();
  }

  let vehicleId = dto.vehicleId ?? null;
  if (cases.includes('DUPLICATE_VEHICLES')) {
    if (!vehicleId || !vehicles.some((v) => v.id === vehicleId)) {
      throw registrationConfirmationMismatch();
    }
  } else if (cases.includes('EXISTING_VEHICLE')) {
    const matchedId = vehicles[0]?.id;
    if (!matchedId) {
      throw registrationConfirmationMismatch();
    }
    if (vehicleId && vehicleId !== matchedId) {
      throw registrationConfirmationMismatch();
    }
    vehicleId = matchedId;
  } else if (vehicleId) {
    throw registrationConfirmationMismatch();
  }

  const createCustomer =
    !cases.includes('EXISTING_CUSTOMER') &&
    !cases.includes('DUPLICATE_CUSTOMERS');
  const createVehicle =
    !cases.includes('EXISTING_VEHICLE') &&
    !cases.includes('DUPLICATE_VEHICLES');

  if (!createCustomer && !customerId) {
    throw registrationConfirmationMismatch();
  }
  if (!createVehicle && !vehicleId) {
    throw registrationConfirmationMismatch();
  }

  return {
    customerId,
    vehicleId,
    createCustomer,
    createVehicle,
  };
}
