import { Prisma } from '@prisma/client';
import {
  VEHICLE_IDENTITY_RESET,
  createIdentityInputFingerprint,
  normalizeVehicleIdentityValue,
  normalizeVehicleIdentityValueOrNull,
} from './vehicle-identity.util';
import {
  SandboxVehicleIdentityProvider,
  VEHICLE_IDENTITY_PROVIDER,
} from './vehicle-identity.provider';

describe('vehicle identity utilities', () => {
  describe('normalizeVehicleIdentityValue()', () => {
    it('trims and uppercases identity values', () => {
      expect(normalizeVehicleIdentityValue('  vf1abc123  ')).toBe('VF1ABC123');
    });

    it('returns an empty string for nullish identity values', () => {
      expect(normalizeVehicleIdentityValue(null)).toBe('');
      expect(normalizeVehicleIdentityValue(undefined)).toBe('');
    });
  });

  describe('normalizeVehicleIdentityValueOrNull()', () => {
    it('returns null for absent values and canonical text for present values', () => {
      expect(normalizeVehicleIdentityValueOrNull(null)).toBeNull();
      expect(normalizeVehicleIdentityValueOrNull(undefined)).toBeNull();
      expect(normalizeVehicleIdentityValueOrNull('   ')).toBeNull();
      expect(normalizeVehicleIdentityValueOrNull(' vf1abc123 ')).toBe(
        'VF1ABC123',
      );
    });
  });

  describe('createIdentityInputFingerprint()', () => {
    it('treats case and surrounding whitespace as equivalent', () => {
      expect(createIdentityInputFingerprint(' vf1abc123 ', ' w-123 ')).toBe(
        createIdentityInputFingerprint('VF1ABC123', 'W-123'),
      );
    });

    it('returns a lowercase SHA-256 hexadecimal fingerprint', () => {
      const fingerprint = createIdentityInputFingerprint('VF1ABC123', 'W-123');

      expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    });

    it('uses the exact normalized VIN and plate hashing contract', () => {
      expect(createIdentityInputFingerprint('VF1ABC123', 'W-123')).toBe(
        'a5c704bbb5da33c859e200d8f26cdae5fc05b5e939f0f166278fbefe933bb53c',
      );
    });

    it('changes when the plate changes', () => {
      expect(createIdentityInputFingerprint('VF1ABC123', 'W-123')).not.toBe(
        createIdentityInputFingerprint('VF1ABC123', 'W-124'),
      );
    });
  });

  it('provides a Prisma-compatible identity reset payload', () => {
    const resetPayload: Prisma.VehicleUpdateInput = VEHICLE_IDENTITY_RESET;

    expect(resetPayload).toMatchObject({
      make_brand_id: null,
      hsn: null,
      tsn: null,
      identity_input_fingerprint: null,
      identity_resolved_at: null,
    });
    expect(resetPayload.identity_keys).toBe(Prisma.JsonNull);
  });
});

describe('SandboxVehicleIdentityProvider', () => {
  const provider = new SandboxVehicleIdentityProvider();

  it('exports a provider injection token', () => {
    expect(typeof VEHICLE_IDENTITY_PROVIDER).toBe('symbol');
  });

  it('resolves VF VINs as Peugeot with normalized VIN identity keys', async () => {
    await expect(
      provider.resolve({ vin: ' vf1abc123 ', plate: ' w-123 ' }),
    ).resolves.toEqual({
      make: 'Peugeot',
      model: 'Sandbox Model',
      year: 2024,
      identity_keys: { vin: 'VF1ABC123' },
    });
  });

  it('resolves non-VF VINs as Volkswagen', async () => {
    await expect(
      provider.resolve({ vin: ' wvwabc123 ', plate: null }),
    ).resolves.toMatchObject({
      make: 'Volkswagen',
      model: 'Sandbox Model',
      year: 2024,
      identity_keys: { vin: 'WVWABC123' },
    });
  });

  it('rejects FAIL VINs with the sandbox resolution error', async () => {
    await expect(
      provider.resolve({ vin: ' fail-vehicle-1 ', plate: null }),
    ).rejects.toThrow(new Error('Sandbox identity resolution failed'));
  });
});
