import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { NovaCalculateRequestDto } from './nova-calculate.dto.js';

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

  it('does not advertise a CO2 maximum the calculator does not enforce', () => {
    const co2Metadata = Reflect.getMetadata(
      'swagger/apiModelProperties',
      NovaCalculateRequestDto.prototype,
      'co2GramsPerKm',
    ) as { maximum?: number };

    expect(co2Metadata.maximum).toBeUndefined();
  });
});
