import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTyreMeasurementDto } from './tyre-measurement.dto.js';

const wheel = {
  position: 'FL',
  season: 'SUMMER',
  treadInnerMm: 4,
  treadMiddleMm: 4,
  treadOuterMm: 4,
};

async function validateWheels(wheels: unknown[]) {
  return validate(plainToInstance(CreateTyreMeasurementDto, { wheels }));
}

describe('tyre capture validation', () => {
  it.each([0, 0.01, 1.6, 2.01, 19.99, 20])(
    'accepts hundredth precision: %s',
    async (value) => {
      await expect(
        validateWheels([{ ...wheel, treadInnerMm: value }]),
      ).resolves.toEqual([]);
    },
  );

  it.each([1e-7, 1.2e-7, 0.001, 1.601, NaN, Infinity, '4'])(
    'rejects invalid precision without throwing: %s',
    async (value) => {
      for (const field of ['treadInnerMm', 'treadMiddleMm', 'treadOuterMm']) {
        const errors = await validateWheels([{ ...wheel, [field]: value }]);
        expect(errors).not.toHaveLength(0);
      }
    },
  );

  it('rejects null wheel entries without throwing', async () => {
    await expect(validateWheels([null])).resolves.not.toHaveLength(0);
  });
});
