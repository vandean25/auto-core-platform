import { BadRequestException } from '@nestjs/common';
import {
  VEHICLE_CO2_WLTP_OUT_OF_RANGE_CODE,
  VEHICLE_FIRST_REGISTRATION_DATE_FUTURE_CODE,
  VEHICLE_NOVA_CLASS_INVALID_CODE,
  assertVehicleRegulatoryFields,
  normalizeVehicleRegulatoryFields,
} from './vehicle-regulatory.validation.js';

describe('vehicle-regulatory.validation', () => {
  it('rejects a future first registration date', () => {
    const future = new Date();
    future.setUTCFullYear(future.getUTCFullYear() + 1);
    const iso = future.toISOString().slice(0, 10);

    expect(() => assertVehicleRegulatoryFields({ first_registration_date: iso })).toThrow(
      BadRequestException,
    );

    try {
      assertVehicleRegulatoryFields({ first_registration_date: iso });
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual(
        expect.objectContaining({
          code: VEHICLE_FIRST_REGISTRATION_DATE_FUTURE_CODE,
          field: 'first_registration_date',
        }),
      );
    }
  });

  it('rejects CO2 WLTP outside 0-600', () => {
    try {
      assertVehicleRegulatoryFields({ co2_wltp_g_km: 601 });
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toEqual(
        expect.objectContaining({
          code: VEHICLE_CO2_WLTP_OUT_OF_RANGE_CODE,
          field: 'co2_wltp_g_km',
        }),
      );
    }
  });

  it('rejects invalid nova_class values', () => {
    try {
      assertVehicleRegulatoryFields({ nova_class: 'UNKNOWN_CLASS' });
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toEqual(
        expect.objectContaining({
          code: VEHICLE_NOVA_CLASS_INVALID_CODE,
          field: 'nova_class',
        }),
      );
    }
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
