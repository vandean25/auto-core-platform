import type { UpdateVehicleDto } from './dto/update-vehicle.dto.js';
import { VEHICLE_IDENTITY_RESET } from './vehicle-identity.util.js';
import {
  buildVehicleCreatePayload,
  buildVehicleIdentityGuard,
  buildVehicleUpdatePayload,
  hasVehicleIdentityChanged,
} from './vehicle-write.mapper.js';

describe('vehicle write mapper', () => {
  const tenantId = 'tenant-1';

  describe('buildVehicleCreatePayload', () => {
    it('canonicalizes the VIN and scopes the row to the tenant', () => {
      expect(
        buildVehicleCreatePayload(
          { make: 'Peugeot', model: '308', year: 2024, vin: ' vf1abc123 ' },
          tenantId,
        ),
      ).toEqual({
        make: 'Peugeot',
        model: '308',
        year: 2024,
        vin: 'VF1ABC123',
        tenant_id: tenantId,
        customer_id: null,
      });
    });

    it('persists a blank VIN as null and omits the VIN key when it is absent', () => {
      expect(
        buildVehicleCreatePayload(
          { make: 'Peugeot', model: '308', year: 2024, vin: '   ' },
          tenantId,
        ),
      ).toMatchObject({ vin: null });
      expect(
        buildVehicleCreatePayload(
          { make: 'Peugeot', model: '308', year: 2024 },
          tenantId,
        ),
      ).not.toHaveProperty('vin');
    });

    it('moves customer_id out of the scalar data onto the relation key', () => {
      const payload = buildVehicleCreatePayload(
        { make: 'Toyota', model: 'Corolla', year: 2022, customer_id: 'cust-1' },
        tenantId,
      );

      expect(payload.customer_id).toBe('cust-1');
      expect(payload).not.toHaveProperty('vin');
    });
  });

  describe('buildVehicleUpdatePayload', () => {
    const existing = { id: 'vehicle-1', vin: 'VIN-1', plate: 'PLATE-1' };

    it('resets identity-derived fields and the resolution token when the plate changes', () => {
      expect(
        buildVehicleUpdatePayload(existing, { plate: 'PLATE-2' }),
      ).toEqual({
        plate: 'PLATE-2',
        ...VEHICLE_IDENTITY_RESET,
        identity_resolution_token: null,
      });
    });

    it('keeps identity fields for an equivalent normalized plate', () => {
      expect(
        buildVehicleUpdatePayload(
          { id: 'vehicle-1', vin: 'VIN-1', plate: ' plate-1 ' },
          { plate: 'PLATE-1' },
        ),
      ).toEqual({ plate: 'PLATE-1' });
    });

    it('passes an explicit customer_id through, including null to detach', () => {
      expect(buildVehicleUpdatePayload(existing, { customer_id: null })).toEqual({
        customer_id: null,
      });
      expect(buildVehicleUpdatePayload(existing, {})).toEqual({});
    });
  });

  describe('hasVehicleIdentityChanged', () => {
    const existing = { vin: 'VIN-1', plate: 'PLATE-1' };

    it('ignores fields that were not supplied', () => {
      const patch: Partial<UpdateVehicleDto> = { make: 'Ford' };
      expect(hasVehicleIdentityChanged(existing, patch)).toBe(false);
    });

    it('treats a VIN that differs only by case and whitespace as unchanged', () => {
      expect(hasVehicleIdentityChanged(existing, { vin: ' vin-1 ' })).toBe(false);
    });

    it('detects a changed VIN or plate', () => {
      expect(hasVehicleIdentityChanged(existing, { vin: 'VIN-2' })).toBe(true);
      expect(hasVehicleIdentityChanged(existing, { plate: null })).toBe(true);
    });
  });

  describe('buildVehicleIdentityGuard', () => {
    it('pins the row to its tenant and the identity state read before the write', () => {
      expect(
        buildVehicleIdentityGuard('vehicle-1', tenantId, {
          id: 'vehicle-1',
          vin: 'VIN-1',
          plate: 'PLATE-1',
          identity_resolution_generation: 'generation-1',
          identity_resolution_token: 'token-1',
        }),
      ).toEqual({
        id: 'vehicle-1',
        tenant_id: tenantId,
        vin: 'VIN-1',
        plate: 'PLATE-1',
        identity_resolution_generation: 'generation-1',
        identity_resolution_token: 'token-1',
      });
    });

    it('treats missing resolution state as null', () => {
      expect(
        buildVehicleIdentityGuard('vehicle-1', tenantId, {
          id: 'vehicle-1',
          vin: null,
          plate: null,
        }),
      ).toEqual({
        id: 'vehicle-1',
        tenant_id: tenantId,
        vin: null,
        plate: null,
        identity_resolution_generation: null,
        identity_resolution_token: null,
      });
    });
  });
});
