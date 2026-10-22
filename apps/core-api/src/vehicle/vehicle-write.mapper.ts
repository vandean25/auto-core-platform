import { Prisma } from '@prisma/client';
import type { CreateVehicleDto } from './dto/create-vehicle.dto.js';
import type { UpdateVehicleDto } from './dto/update-vehicle.dto.js';
import {
  VEHICLE_IDENTITY_RESET,
  normalizeVehicleIdentityValue,
  normalizeVehicleIdentityValueOrNull,
} from './vehicle-identity.util.js';

export interface ExistingVehicleIdentity {
  id: string;
  vin: string | null;
  plate: string | null;
  identity_resolution_generation?: string | null;
  identity_resolution_token?: string | null;
}

export function buildVehicleCreatePayload(
  dto: CreateVehicleDto,
  tenantId: string,
): Prisma.VehicleUncheckedCreateInput {
  const { customer_id, vin, ...scalarData } = dto;

  return {
    ...scalarData,
    ...(vin !== undefined
      ? { vin: normalizeVehicleIdentityValueOrNull(vin) }
      : {}),
    tenant_id: tenantId,
    customer_id: customer_id ?? null,
  };
}

export function buildVehicleUpdatePayload(
  existingVehicle: ExistingVehicleIdentity,
  updateVehicleDto: UpdateVehicleDto,
): Prisma.VehicleUncheckedUpdateManyInput {
  const { customer_id, vin, ...scalarData } = updateVehicleDto;
  const identityChanged = hasVehicleIdentityChanged(
    existingVehicle,
    updateVehicleDto,
  );

  return {
    ...scalarData,
    ...(vin !== undefined
      ? { vin: normalizeVehicleIdentityValueOrNull(vin) }
      : {}),
    ...(customer_id !== undefined ? { customer_id } : {}),
    ...(identityChanged
      ? { ...VEHICLE_IDENTITY_RESET, identity_resolution_token: null }
      : {}),
  };
}

export function hasVehicleIdentityChanged(
  existingVehicle: Pick<ExistingVehicleIdentity, 'vin' | 'plate'>,
  updateVehicleDto: { vin?: string | null; plate?: string | null },
): boolean {
  const vinChanged =
    updateVehicleDto.vin !== undefined &&
    normalizeVehicleIdentityValue(existingVehicle.vin) !==
      normalizeVehicleIdentityValue(updateVehicleDto.vin);

  const plateChanged =
    updateVehicleDto.plate !== undefined &&
    normalizeVehicleIdentityValue(existingVehicle.plate) !==
      normalizeVehicleIdentityValue(updateVehicleDto.plate);

  return vinChanged || plateChanged;
}

/**
 * Optimistic guard for identity-sensitive updates: the row must still carry the
 * VIN, plate and resolution state that were read before the write.
 */
export function buildVehicleIdentityGuard(
  id: string,
  tenantId: string,
  existingVehicle: ExistingVehicleIdentity,
): Prisma.VehicleWhereInput {
  return {
    id,
    tenant_id: tenantId,
    vin: existingVehicle.vin,
    plate: existingVehicle.plate,
    identity_resolution_generation:
      existingVehicle.identity_resolution_generation ?? null,
    identity_resolution_token:
      existingVehicle.identity_resolution_token ?? null,
  };
}
