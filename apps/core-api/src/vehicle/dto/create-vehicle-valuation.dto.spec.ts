import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { createGlobalValidationPipe } from '../../common/index.js';
import { CreateVehicleValuationDto } from './vehicle-valuation.dto.js';

const fixtures = JSON.parse(
  readFileSync(
    path.join(
      import.meta.dirname,
      '../../../test/fixtures/vehicle-nationalcode-valuation.fixtures.json',
    ),
    'utf8',
  ),
) as {
  cases: Record<string, { http: { body: Record<string, unknown> } }>;
};

describe('CreateVehicleValuationDto validation', () => {
  const pipe = createGlobalValidationPipe();

  it('rejects nationalCode in the body before the service runs', async () => {
    const caseFix = fixtures.cases['national-code-in-body'];

    await expect(
      pipe.transform(caseFix.http.body, {
        type: 'body',
        metatype: CreateVehicleValuationDto,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a valid quote body', async () => {
    const dto = await pipe.transform(
      {
        valuationType: 'MARKET_VALUE',
        mileageKm: 84200,
        condition: 'ROADWORTHY_AVERAGE',
        requestedAsOf: '2026-10-15',
        currency: 'EUR',
      },
      { type: 'body', metatype: CreateVehicleValuationDto },
    );
    expect(dto).toMatchObject({ valuationType: 'MARKET_VALUE', currency: 'EUR' });
  });

  it('rejects a non-ISO requestedAsOf shape at the pipe', async () => {
    const instance = plainToInstance(CreateVehicleValuationDto, {
      valuationType: 'MARKET_VALUE',
      mileageKm: 1,
      condition: 'POOR',
      requestedAsOf: '15-10-2026',
      currency: 'EUR',
    });
    const errors = await validate(instance);
    expect(errors.some((error) => error.property === 'requestedAsOf')).toBe(
      true,
    );
  });
});
