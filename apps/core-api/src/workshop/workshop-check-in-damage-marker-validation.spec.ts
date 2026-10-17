import { BadRequestException } from '@nestjs/common';
import { assertCheckInDamageMarkerContract } from './workshop-check-in-damage-marker-validation.js';
import { CHECK_IN_ERROR_CODES } from './workshop-check-in.rules.js';

describe('assertCheckInDamageMarkerContract', () => {
  const validMarker = {
    id: '51500000-0000-4000-8000-000000000556',
    zone_id: 'REAR_BUMPER',
    type: 'SCRATCH',
    note: '',
    media_ids: [] as string[],
  };

  it('accepts canonical zone and damage type ids', () => {
    expect(() => assertCheckInDamageMarkerContract([validMarker])).not.toThrow();
  });

  it('rejects unknown zone_id with CHECK_IN_ZONE_INVALID', () => {
    expect(() =>
      assertCheckInDamageMarkerContract([
        { ...validMarker, zone_id: 'rear_bumper' },
      ]),
    ).toThrow(BadRequestException);
    try {
      assertCheckInDamageMarkerContract([
        { ...validMarker, zone_id: 'rear_bumper' },
      ]);
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: CHECK_IN_ERROR_CODES.CHECK_IN_ZONE_INVALID,
      });
    }
  });

  it('rejects unknown damage type with CHECK_IN_DAMAGE_TYPE_INVALID', () => {
    try {
      assertCheckInDamageMarkerContract([
        { ...validMarker, type: 'RUST' },
      ]);
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: CHECK_IN_ERROR_CODES.CHECK_IN_DAMAGE_TYPE_INVALID,
      });
    }
  });
});
