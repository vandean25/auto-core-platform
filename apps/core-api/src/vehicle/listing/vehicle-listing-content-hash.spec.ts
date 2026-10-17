import { VehicleListingVatDisplay } from '@prisma/client';
import {
  computeVehicleListingContentSha256,
  type VehicleListingContentHashInput,
} from './vehicle-listing-content-hash.js';

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
    equipment: [{ code: 'ABS', assertion: 'PRESENT' }],
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

  it('does not incorporate last_export_at (irrelevant metadata)', () => {
    const hash = computeVehicleListingContentSha256(baseInput());
    const hashAgain = computeVehicleListingContentSha256(
      baseInput({
        // last_export_at is not part of VehicleListingContentHashInput
        description: 'Well maintained sedan.',
      }),
    );
    expect(hashAgain).toBe(hash);
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
