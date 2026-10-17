import { VehicleListingVatDisplay } from '@prisma/client';
import {
  buildVehicleListingContentHashPayload,
  computeVehicleListingContentSha256,
  sortJsonValue,
  type VehicleListingContentHashInput,
} from './vehicle-listing-content-hash.js';

const baseVehicle = {
  make: 'VW',
  model: 'Golf',
  model_year: 2020,
  mileage_km: 45000,
  fuel: 'PETROL',
  power_kw: 85,
  first_registration: '2020-03-15',
  co2_wltp_g_km: 120,
  co2_nedc_g_km: null,
  color: 'Black',
  emission_class: 'EURO6',
};

function baseInput(
  overrides: Partial<VehicleListingContentHashInput> = {},
): VehicleListingContentHashInput {
  return {
    listing_ref: 'Labc123',
    title: null,
    description: 'Well maintained sedan.',
    description_language: 'DE',
    price_gross_eur: '15000.00',
    vat_display: VehicleListingVatDisplay.STANDARD,
    nova_included_confirmed: true,
    mandatory_fees_included_confirmed: true,
    equipment_free_text: null,
    portal_category: 'Car.Limousine',
    export_assertions: {
      damage_free: true,
      metallic: false,
      guarantee: false,
      jahreswagen: false,
      recommendation: false,
      demo_vehicle: false,
    },
    equipment: [{ code: 'ABS', assertion: 'PRESENT' }],
    equipment_free_text_lines: [{ sort_order: 0, text: 'Panoramic roof' }],
    photos: [
      {
        media_id: 'photo-1',
        content_sha256: 'a'.repeat(64),
        sort_order: 0,
      },
    ],
    channels: [
      {
        platform: 'MOBILE_DE',
        serializer_profile: 'MOBILE_DE_REFERENCE_V1',
        mapping_version: '1',
      },
      {
        platform: 'AS24',
        serializer_profile: 'AS24_PROVISIONAL_V1',
        mapping_version: '1',
      },
    ],
    vehicle: baseVehicle,
    ...overrides,
  };
}

describe('computeVehicleListingContentSha256', () => {
  it('is stable for the same canonical payload', () => {
    const input = baseInput();
    const first = computeVehicleListingContentSha256(input);
    const second = computeVehicleListingContentSha256(input);
    expect(first).toBe(second);
    expect(first).toHaveLength(64);
  });

  it('changes when exported description changes', () => {
    const before = computeVehicleListingContentSha256(baseInput());
    const after = computeVehicleListingContentSha256(
      baseInput({ description: 'Updated description text.' }),
    );
    expect(after).not.toBe(before);
  });

  it('changes when equipment assertion changes', () => {
    const before = computeVehicleListingContentSha256(baseInput());
    const after = computeVehicleListingContentSha256(
      baseInput({
        equipment: [{ code: 'ABS', assertion: 'ABSENT' }],
      }),
    );
    expect(after).not.toBe(before);
  });

  it('changes when equipment free-text line changes', () => {
    const before = computeVehicleListingContentSha256(baseInput());
    const after = computeVehicleListingContentSha256(
      baseInput({
        equipment_free_text_lines: [{ sort_order: 0, text: 'Tow bar fitted' }],
      }),
    );
    expect(after).not.toBe(before);
  });

  it('changes when price changes', () => {
    const before = computeVehicleListingContentSha256(baseInput());
    const after = computeVehicleListingContentSha256(
      baseInput({ price_gross_eur: '15001.00' }),
    );
    expect(after).not.toBe(before);
  });

  it('changes when vehicle color changes', () => {
    const before = computeVehicleListingContentSha256(baseInput());
    const after = computeVehicleListingContentSha256(
      baseInput({
        vehicle: { ...baseVehicle, color: 'White' },
      }),
    );
    expect(after).not.toBe(before);
  });

  it('changes when vehicle mileage changes', () => {
    const before = computeVehicleListingContentSha256(baseInput());
    const after = computeVehicleListingContentSha256(
      baseInput({
        vehicle: { ...baseVehicle, mileage_km: 45001 },
      }),
    );
    expect(after).not.toBe(before);
  });

  it('changes when photo digest changes', () => {
    const before = computeVehicleListingContentSha256(baseInput());
    const after = computeVehicleListingContentSha256(
      baseInput({
        photos: [
          {
            media_id: 'photo-1',
            content_sha256: 'b'.repeat(64),
            sort_order: 0,
          },
        ],
      }),
    );
    expect(after).not.toBe(before);
  });

  it('does not include last_export_at or desired_state in the payload keys', () => {
    const payload = buildVehicleListingContentHashPayload(baseInput());
    expect(Object.keys(payload).sort()).toEqual(
      [
        'channels',
        'description',
        'description_language',
        'equipment',
        'equipment_free_text',
        'equipment_free_text_lines',
        'export_assertions',
        'listing_ref',
        'mandatory_fees_included_confirmed',
        'nova_included_confirmed',
        'photos',
        'portal_category',
        'price_gross_eur',
        'schema_version',
        'title',
        'vat_display',
        'vehicle',
      ].sort(),
    );
  });

  it('sorts object keys so property order does not change the digest', () => {
    const ordered = computeVehicleListingContentSha256(
      baseInput({
        equipment: [
          { code: 'ESP', assertion: 'PRESENT' },
          { code: 'ABS', assertion: 'PRESENT' },
        ],
      }),
    );
    const reversed = computeVehicleListingContentSha256(
      baseInput({
        equipment: [
          { assertion: 'PRESENT', code: 'ABS' },
          { assertion: 'PRESENT', code: 'ESP' },
        ],
      }),
    );
    expect(ordered).toBe(reversed);
  });

  it('sorts equipment and channels deterministically', () => {
    const unsorted = computeVehicleListingContentSha256(
      baseInput({
        equipment: [
          { code: 'ESP', assertion: 'PRESENT' },
          { code: 'ABS', assertion: 'PRESENT' },
        ],
        channels: [
          {
            platform: 'WILLHABEN',
            serializer_profile: 'WILLHABEN_GENERIC_V1',
            mapping_version: '1',
          },
          {
            platform: 'AS24',
            serializer_profile: 'AS24_PROVISIONAL_V1',
            mapping_version: '1',
          },
          {
            platform: 'MOBILE_DE',
            serializer_profile: 'MOBILE_DE_REFERENCE_V1',
            mapping_version: '1',
          },
        ],
      }),
    );
    const sorted = computeVehicleListingContentSha256(
      baseInput({
        equipment: [
          { code: 'ABS', assertion: 'PRESENT' },
          { code: 'ESP', assertion: 'PRESENT' },
        ],
        channels: [
          {
            platform: 'AS24',
            serializer_profile: 'AS24_PROVISIONAL_V1',
            mapping_version: '1',
          },
          {
            platform: 'MOBILE_DE',
            serializer_profile: 'MOBILE_DE_REFERENCE_V1',
            mapping_version: '1',
          },
          {
            platform: 'WILLHABEN',
            serializer_profile: 'WILLHABEN_GENERIC_V1',
            mapping_version: '1',
          },
        ],
      }),
    );
    expect(unsorted).toBe(sorted);
  });
});

describe('sortJsonValue', () => {
  it('recursively sorts object keys', () => {
    expect(
      sortJsonValue({ b: 1, a: { d: 2, c: 3 } }),
    ).toEqual({ a: { c: 3, d: 2 }, b: 1 });
  });
});
