import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { PickWorkshopPartsDto } from './pick-workshop-parts.dto';

const collectConstraintMessages = (errors: ValidationError[]): string[] =>
  errors.flatMap((error) => [
    ...(error.constraints ? Object.values(error.constraints) : []),
    ...collectConstraintMessages(error.children ?? []),
  ]);

describe('PickWorkshopPartsDto', () => {
  it('accepts valid decimal quantities up to 3 decimal places', async () => {
    for (const quantity of [0.001, 0.5, 1.5, 4]) {
      const dto = plainToInstance(PickWorkshopPartsDto, {
        destinationLocationId: '550e8400-e29b-41d4-a716-446655440000',
        items: [
          {
            workshopTaskLineItemId: '550e8400-e29b-41d4-a716-446655440001',
            quantity,
          },
        ],
      });

      const errors = await validate(dto);
      expect(errors).toEqual([]);
    }
  });

  it('rejects quantities with more than 3 decimal places', async () => {
    const dto = plainToInstance(PickWorkshopPartsDto, {
      destinationLocationId: '550e8400-e29b-41d4-a716-446655440000',
      items: [
        {
          workshopTaskLineItemId: '550e8400-e29b-41d4-a716-446655440001',
          quantity: 1.2345,
        },
      ],
    });

    const errors = await validate(dto);
    const messages = collectConstraintMessages(errors);

    expect(messages).toContain(
      'quantity must be a number conforming to the specified constraints',
    );
  });

  it('rejects zero and negative quantities', async () => {
    for (const quantity of [0, -1, -0.001]) {
      const dto = plainToInstance(PickWorkshopPartsDto, {
        destinationLocationId: '550e8400-e29b-41d4-a716-446655440000',
        items: [
          {
            workshopTaskLineItemId: '550e8400-e29b-41d4-a716-446655440001',
            quantity,
          },
        ],
      });

      const errors = await validate(dto);
      const messages = collectConstraintMessages(errors);

      expect(messages).toContain('quantity must not be less than 0.001');
    }
  });
});
