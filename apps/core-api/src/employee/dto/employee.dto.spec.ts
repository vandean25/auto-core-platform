import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateEmployeeDto } from './employee.dto';

describe('Employee DTO date fields', () => {
  it('rejects a timestamp when a hire date is expected', async () => {
    const dto = plainToInstance(UpdateEmployeeDto, {
      hiredOn: '2026-02-03T00:00:00.000Z',
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'hiredOn')).toBe(true);
  });
});
