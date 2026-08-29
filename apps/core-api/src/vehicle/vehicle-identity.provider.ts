import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { normalizeVehicleIdentityValue } from './vehicle-identity.util';

export const VEHICLE_IDENTITY_PROVIDER = Symbol('VehicleIdentityProvider');

export interface VehicleIdentityProviderInput {
  vin: string;
  plate: string | null;
}

export interface VehicleIdentityProviderResult {
  make: string;
  model: string;
  year?: number;
  engine_code?: string;
  hsn?: string;
  tsn?: string;
  fuel_type?: string;
  power_kw?: number;
  identity_keys?: Prisma.InputJsonObject;
}

export interface VehicleIdentityProvider {
  resolve(
    input: VehicleIdentityProviderInput,
  ): Promise<VehicleIdentityProviderResult>;
}

@Injectable()
export class SandboxVehicleIdentityProvider implements VehicleIdentityProvider {
  resolve(
    input: VehicleIdentityProviderInput,
  ): Promise<VehicleIdentityProviderResult> {
    const normalizedVin = normalizeVehicleIdentityValue(input.vin);

    if (normalizedVin.startsWith('FAIL')) {
      return Promise.reject(new Error('Sandbox identity resolution failed'));
    }

    return Promise.resolve({
      make: normalizedVin.startsWith('VF') ? 'Peugeot' : 'Volkswagen',
      model: 'Sandbox Model',
      year: 2024,
      identity_keys: { vin: normalizedVin },
    });
  }
}
