import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { ReceivePurchaseOrderDto } from './receive-items.dto';

const collectConstraintMessages = (errors: ValidationError[]): string[] =>
  errors.flatMap((error) => [
    ...(error.constraints ? Object.values(error.constraints) : []),
    ...collectConstraintMessages(error.children ?? []),
  ]);

describe('ReceivePurchaseOrderDto', () => {
  it('accepts valid decimal quantities up to 3 decimal places', async () => {
    for (const quantity of [0.001, 0.5, 1.5, 4]) {
      const dto = plainToInstance(ReceivePurchaseOrderDto, {
        items: [
          {
            itemId: '550e8400-e29b-41d4-a716-446655440000',
            quantity,
          },
        ],
      });

      const errors = await validate(dto);
      expect(errors).toEqual([]);
    }
  });

  it('rejects quantities with more than 3 decimal places', async () => {
    const dto = plainToInstance(ReceivePurchaseOrderDto, {
      items: [
        {
          itemId: '550e8400-e29b-41d4-a716-446655440000',
          quantity: 1.5001,
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
      const dto = plainToInstance(ReceivePurchaseOrderDto, {
        items: [
          {
            itemId: '550e8400-e29b-41d4-a716-446655440000',
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
