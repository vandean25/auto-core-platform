import { BadRequestException } from '@nestjs/common';
import { assertVehicleInspectionRecordFields } from './vehicle-inspection-record.validation.js';

describe('assertVehicleInspectionRecordFields', () => {
  const referenceDate = new Date('2026-10-02T12:00:00.000Z');

  it('rejects future inspected_on', () => {
    expect(() =>
      assertVehicleInspectionRecordFields(
        {
          inspected_on: '2026-10-03',
          plaketten_valid_until_year: 2027,
          plaketten_valid_until_month: 3,
        },
        referenceDate,
      ),
    ).toThrow(BadRequestException);
  });

  it('allows inspected_on on the Vienna calendar day when UTC is still yesterday', () => {
    assertVehicleInspectionRecordFields(
      {
        inspected_on: '2026-10-03',
        plaketten_valid_until_year: 2027,
        plaketten_valid_until_month: 3,
      },
      new Date('2026-10-02T22:30:00.000Z'),
    );
  });

  it('rejects plakette month before inspection month', () => {
    expect(() =>
      assertVehicleInspectionRecordFields(
        {
          inspected_on: '2026-06-15',
          plaketten_valid_until_year: 2026,
          plaketten_valid_until_month: 5,
        },
        referenceDate,
      ),
    ).toThrow(BadRequestException);
  });
});
