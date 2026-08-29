import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

export function normalizeVehicleIdentityValue(
  value: string | null | undefined,
): string {
  return value?.trim().toUpperCase() ?? '';
}

export function normalizeVehicleIdentityValueOrNull(
  value: string | null | undefined,
): string | null {
  const normalizedValue = normalizeVehicleIdentityValue(value);
  return normalizedValue || null;
}

export function createIdentityInputFingerprint(
  vin: string | null | undefined,
  plate: string | null | undefined,
): string {
  const normalizedVin = normalizeVehicleIdentityValue(vin);
  const normalizedPlate = normalizeVehicleIdentityValue(plate);

  return createHash('sha256')
    .update(`${normalizedVin}|${normalizedPlate}`, 'utf8')
    .digest('hex');
}

export function stripVehicleIdentityResolutionState<
  T extends {
    identity_resolution_generation?: string | null;
    identity_resolution_token?: string | null;
  },
>(vehicle: T) {
  const {
    identity_resolution_generation: identityResolutionGeneration,
    identity_resolution_token: identityResolutionToken,
    ...publicVehicle
  } = vehicle;
  void identityResolutionGeneration;
  void identityResolutionToken;
  return publicVehicle;
}

export const VEHICLE_IDENTITY_RESET = {
  make_brand_id: null,
  hsn: null,
  tsn: null,
  identity_keys: Prisma.JsonNull,
  identity_input_fingerprint: null,
  identity_resolved_at: null,
} satisfies Prisma.VehicleUpdateInput & Prisma.VehicleUncheckedUpdateInput;
