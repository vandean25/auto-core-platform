import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PlannerQueryDto } from './workshop-planner.dto';

describe('PlannerQueryDto', () => {
  it('accepts ISO from/to instants', async () => {
    const dto = plainToInstance(PlannerQueryDto, {
      from: '2026-08-21T00:00:00.000Z',
      to: '2026-08-22T00:00:00.000Z',
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('rejects array from query values', async () => {
    const dto = plainToInstance(PlannerQueryDto, {
      from: ['2026-08-21T00:00:00.000Z', '2026-08-22T00:00:00.000Z'],
      to: '2026-08-22T00:00:00.000Z',
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'from')).toBe(true);
  });
});
