import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { ValidationError, validateSync } from 'class-validator';
import { createGlobalValidationPipe } from '../../common/validation.pipe.js';
import { NovaCalculateRequestDto } from './nova-calculate.dto.js';

const validationPipe = createGlobalValidationPipe();

function constraintMessages(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
}

describe('NovaCalculateRequestDto', () => {
  it('lets the engine map negative monetary and CO2 values to stable 422 codes', () => {
    const dto = plainToInstance(NovaCalculateRequestDto, {
      co2GramsPerKm: -1,
      emissionCycle: 'WLTP',
      netPriceEuro: -1,
      driveType: 'ICE',
      taxableEventDate: '2025-03-01',
    });

    expect(validateSync(dto)).toEqual([]);
  });

  it('lets the engine map malformed ISO dates to INVALID_ISO_DATE', () => {
    const dto = plainToInstance(NovaCalculateRequestDto, {
      co2GramsPerKm: 100,
      emissionCycle: 'WLTP',
      netPriceEuro: 10000,
      driveType: 'ICE',
      taxableEventDate: 'not-a-date',
    });

    expect(validateSync(dto)).toEqual([]);
  });

  it.each(['', '  ', null, false])(
    'rejects a %s CO2 override instead of coercing it to zero',
    (co2GramsPerKm) => {
    const dto = plainToInstance(NovaCalculateRequestDto, {
      co2GramsPerKm,
      netPriceEuro: 10000,
      vehicleId: '450bda65-fc7c-4a91-b25f-3ae953083377',
    });

    expect(validateSync(dto).map((error) => error.property)).toContain(
      'co2GramsPerKm',
    );
    },
  );

  it('requires explicit calculation fields when no vehicle is supplied', () => {
    const dto = plainToInstance(NovaCalculateRequestDto, {
      netPriceEuro: 10000,
    });

    expect(validateSync(dto).map((error) => error.property).sort()).toEqual([
      'driveType',
      'emissionCycle',
      'taxableEventDate',
    ]);
  });

  it('allows vehicle mode to omit fields resolved from the vehicle', () => {
    const dto = plainToInstance(NovaCalculateRequestDto, {
      netPriceEuro: 10000,
      vehicleId: '450bda65-fc7c-4a91-b25f-3ae953083377',
    });

    expect(validateSync(dto)).toEqual([]);
  });

  it.each([
    ['emissionCycle', { emissionCycle: 'INVALID' }],
    ['driveType', { driveType: 'INVALID' }],
  ])('validates a supplied vehicle override for %s', (property, override) => {
    const dto = plainToInstance(NovaCalculateRequestDto, {
      netPriceEuro: 10000,
      vehicleId: '450bda65-fc7c-4a91-b25f-3ae953083377',
      ...override,
    });

    expect(validateSync(dto).map((error) => error.property)).toContain(property);
  });

  it('rejects a non-string taxableEventDate on eu_used_m1 with HTTP 400 semantics', async () => {
    await expect(
      validationPipe.transform(
        {
          importMode: 'eu_used_m1',
          vehicleClass: 'passenger_z3',
          co2GramsPerKm: 160,
          firstRegistrationDate: '2024-06-01',
          taxableEventDate: 20_240_601,
          netPriceEuro: 20_000,
          valueBasis: 'achtelung',
        },
        { type: 'body', metatype: NovaCalculateRequestDto },
      ),
    ).rejects.toBeDefined();
  });

  it('does not require emissionCycle, driveType, or taxableEventDate for eu_used_m1 without vehicleId', () => {
    const dto = plainToInstance(NovaCalculateRequestDto, {
      importMode: 'eu_used_m1',
      vehicleClass: 'passenger_z3',
      co2GramsPerKm: 160,
      firstRegistrationDate: '2024-06-01',
      netPriceEuro: 20_000,
      valueBasis: 'achtelung',
    });

    expect(validateSync(dto)).toEqual([]);
  });

  it('does not advertise a CO2 maximum the calculator does not enforce', () => {
    const co2Metadata = Reflect.getMetadata(
      'swagger/apiModelProperties',
      NovaCalculateRequestDto.prototype,
      'co2GramsPerKm',
    ) as { maximum?: number };

    expect(co2Metadata.maximum).toBeUndefined();
  });

  it('names the allowed values for importMode and emissionCycle on the repro body', () => {
    const dto = plainToInstance(NovaCalculateRequestDto, {
      netPriceEuro: 1,
      emissionCycle: 'NEDC2',
      driveType: 'ICE',
      taxableEventDate: '2026-10-24',
      importMode: 'zzz',
    });

    const messages = constraintMessages(validateSync(dto));
    expect(messages).toContain(
      'importMode must be one of the following values: eu_used_m1, third_country, previously_exempt',
    );
    expect(messages).toContain(
      'emissionCycle must be one of the following values: WLTP, NEDC',
    );
  });

  it.each([
    ['driveType', 'HYBRID', 'BEV, FCEV, PHEV, ICE, OTHER'],
    ['vehicleClass', 'suv', 'passenger_z3, n1_legacy_z6, motorcycle_z1_z2'],
  ])(
    'names the allowed values for %s when an invalid one is supplied',
    (property, invalidValue, allowedValues) => {
      const dto = plainToInstance(NovaCalculateRequestDto, {
        netPriceEuro: 10000,
        emissionCycle: 'WLTP',
        driveType: 'ICE',
        taxableEventDate: '2026-10-24',
        [property]: invalidValue,
      });

      expect(constraintMessages(validateSync(dto))).toContain(
        `${property} must be one of the following values: ${allowedValues}`,
      );
    },
  );
});
