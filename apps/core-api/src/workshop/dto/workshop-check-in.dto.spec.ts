import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateWorkshopCheckInDto } from './workshop-check-in.dto.js';

describe('UpdateWorkshopCheckInDto', () => {
  it('accepts AUT-385 damage marker shape', async () => {
    const dto = plainToInstance(UpdateWorkshopCheckInDto, {
      expected_revision: 1,
      damage_markers: [
        {
          id: '51500000-0000-4000-8000-000000000556',
          zone_id: 'rear_bumper',
          type: 'SCRATCH',
          note: 'pilot customer scratch',
          media_ids: ['51500000-0000-4000-8000-000000000557'],
        },
      ],
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('rejects null optional fields', async () => {
    const dto = plainToInstance(UpdateWorkshopCheckInDto, {
      expected_revision: 1,
      items_left: null,
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'items_left')).toBe(true);
  });

  it('rejects empty warning light strings', async () => {
    const dto = plainToInstance(UpdateWorkshopCheckInDto, {
      expected_revision: 1,
      warning_lights: [''],
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'warning_lights')).toBe(
      true,
    );
  });

  it('rejects legacy single media_id field', async () => {
    const dto = plainToInstance(UpdateWorkshopCheckInDto, {
      expected_revision: 1,
      damage_markers: [
        {
          zone_id: 'rear_bumper',
          type: 'SCRATCH',
          media_id: null,
        },
      ],
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
