import { BadRequestException } from '@nestjs/common';
import {
  VEHICLE_CO2_NEDC_OUT_OF_RANGE_CODE,
  VEHICLE_CO2_WLTP_OUT_OF_RANGE_CODE,
  VEHICLE_FIRST_REGISTRATION_DATE_FUTURE_CODE,
  VEHICLE_FIRST_REGISTRATION_DATE_INVALID_CODE,
  VEHICLE_NOVA_CLASS_INVALID_CODE,
  assertVehicleRegulatoryFields,
  normalizeVehicleRegulatoryFields,
} from './vehicle-regulatory.validation.js';

function expectBadRequest(
  fn: () => void,
  code: string,
  field: string,
): void {
  try {
    fn();
    throw new Error('expected BadRequestException');
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toEqual(
      expect.objectContaining({ code, field }),
    );
  }
}

describe('vehicle-regulatory.validation', () => {
  it('rejects a future first registration date', () => {
    const future = new Date();
    future.setUTCFullYear(future.getUTCFullYear() + 1);
    const iso = future.toISOString().slice(0, 10);

    expectBadRequest(
      () => assertVehicleRegulatoryFields({ first_registration_date: iso }),
      VEHICLE_FIRST_REGISTRATION_DATE_FUTURE_CODE,
      'first_registration_date',
    );
  });

  it('rejects invalid date format with INVALID code', () => {
    expectBadRequest(
      () => assertVehicleRegulatoryFields({ first_registration_date: 'not-a-date' }),
      VEHICLE_FIRST_REGISTRATION_DATE_INVALID_CODE,
      'first_registration_date',
    );
  });

  it('rejects non-string first registration date with INVALID code', () => {
    expectBadRequest(
      () =>
        assertVehicleRegulatoryFields({
          first_registration_date: 20240315 as unknown as string,
        }),
      VEHICLE_FIRST_REGISTRATION_DATE_INVALID_CODE,
      'first_registration_date',
    );
  });

  it('rejects date strings with trailing garbage', () => {
    expectBadRequest(
      () =>
        assertVehicleRegulatoryFields({
          first_registration_date: '2024-03-15garbage',
        }),
      VEHICLE_FIRST_REGISTRATION_DATE_INVALID_CODE,
      'first_registration_date',
    );
  });

  it('rejects impossible calendar dates with INVALID code', () => {
    expectBadRequest(
      () => assertVehicleRegulatoryFields({ first_registration_date: '2024-02-30' }),
      VEHICLE_FIRST_REGISTRATION_DATE_INVALID_CODE,
      'first_registration_date',
    );
  });

  it('accepts ISO datetime by using the date portion only', () => {
    expect(() =>
      assertVehicleRegulatoryFields({
        first_registration_date: '2020-06-15T10:00:00Z',
      }),
    ).not.toThrow();
  });

  it('rejects non-integer CO2 values such as booleans', () => {
    expectBadRequest(
      () =>
        assertVehicleRegulatoryFields({
          co2_wltp_g_km: true as unknown as number,
        }),
      VEHICLE_CO2_WLTP_OUT_OF_RANGE_CODE,
      'co2_wltp_g_km',
    );
  });

  it('validates CO2 WLTP boundaries and null clear', () => {
    expect(() =>
      assertVehicleRegulatoryFields({ co2_wltp_g_km: 0 }),
    ).not.toThrow();
    expect(() =>
      assertVehicleRegulatoryFields({ co2_wltp_g_km: 600 }),
    ).not.toThrow();
    expect(() =>
      assertVehicleRegulatoryFields({ co2_wltp_g_km: null }),
    ).not.toThrow();

    expectBadRequest(
      () => assertVehicleRegulatoryFields({ co2_wltp_g_km: -1 }),
      VEHICLE_CO2_WLTP_OUT_OF_RANGE_CODE,
      'co2_wltp_g_km',
    );
    expectBadRequest(
      () => assertVehicleRegulatoryFields({ co2_wltp_g_km: 601 }),
      VEHICLE_CO2_WLTP_OUT_OF_RANGE_CODE,
      'co2_wltp_g_km',
    );
    expectBadRequest(
      () => assertVehicleRegulatoryFields({ co2_wltp_g_km: Number.NaN }),
      VEHICLE_CO2_WLTP_OUT_OF_RANGE_CODE,
      'co2_wltp_g_km',
    );
  });

  it('validates CO2 NEDC out of range', () => {
    expectBadRequest(
      () => assertVehicleRegulatoryFields({ co2_nedc_g_km: 700 }),
      VEHICLE_CO2_NEDC_OUT_OF_RANGE_CODE,
      'co2_nedc_g_km',
    );
  });

  it('rejects invalid nova_class values', () => {
    expectBadRequest(
      () => assertVehicleRegulatoryFields({ nova_class: 'BOGUS' }),
      VEHICLE_NOVA_CLASS_INVALID_CODE,
      'nova_class',
    );
  });

  it('normalizes trimmed strings and uppercases nova_class', () => {
    const normalized = normalizeVehicleRegulatoryFields({
      typenschein_no: '  TS-1  ',
      emission_class: '  Euro 6d  ',
      nova_class: 'standard',
    });

    expect(normalized.typenschein_no).toBe('TS-1');
    expect(normalized.emission_class).toBe('Euro 6d');
    expect(normalized.nova_class).toBe('STANDARD');
  });
});
