import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { PickWorkshopPartsDto } from './pick-workshop-parts.dto';

const collectConstraintMessages = (errors: ValidationError[]): string[] =>
  errors.flatMap((error) => [
    ...(error.constraints ? Object.values(error.constraints) : []),
    ...collectConstraintMessages(error.children ?? []),
  ]);

describe('PickWorkshopPartsDto', () => {
  it('rejects fractional quantities', async () => {
    const dto = plainToInstance(PickWorkshopPartsDto, {
      destinationLocationId: '550e8400-e29b-41d4-a716-446655440000',
      items: [
        {
          workshopTaskLineItemId: '550e8400-e29b-41d4-a716-446655440001',
          quantity: 0.5,
        },
      ],
    });

    const errors = await validate(dto);
    const messages = collectConstraintMessages(errors);

    expect(messages).toContain('quantity must be an integer number');
  });

  it('accepts whole-number quantities of at least one', async () => {
    const dto = plainToInstance(PickWorkshopPartsDto, {
      destinationLocationId: '550e8400-e29b-41d4-a716-446655440000',
      items: [
        {
          workshopTaskLineItemId: '550e8400-e29b-41d4-a716-446655440001',
          quantity: 1,
        },
      ],
    });

    const errors = await validate(dto);

    expect(errors).toEqual([]);
  });
});
