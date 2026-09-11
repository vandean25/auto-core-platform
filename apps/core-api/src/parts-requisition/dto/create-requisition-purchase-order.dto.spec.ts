import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { CreateRequisitionPurchaseOrderDto } from './create-requisition-purchase-order.dto';

const collectConstraintMessages = (errors: ValidationError[]): string[] =>
  errors.flatMap((error) => [
    ...(error.constraints ? Object.values(error.constraints) : []),
    ...collectConstraintMessages(error.children ?? []),
  ]);

const build = (unitCost: unknown) =>
  plainToInstance(CreateRequisitionPurchaseOrderDto, {
    vendorId: '550e8400-e29b-41d4-a716-446655440000',
    items: [
      {
        reservationId: '550e8400-e29b-41d4-a716-446655440001',
        unitCost,
      },
    ],
  });

describe('CreateRequisitionPurchaseOrderDto', () => {
  it('accepts numeric unit costs including zero', async () => {
    for (const unitCost of [0, 10.5, 12]) {
      await expect(validate(build(unitCost))).resolves.toEqual([]);
    }
  });

  it('rejects string, empty, null, negative and over-precision unit costs', async () => {
    for (const unitCost of ['', ' ', '0', '10.50', null, -1, 10.001]) {
      const messages = collectConstraintMessages(await validate(build(unitCost)));

      expect(messages.length).toBeGreaterThan(0);
    }
  });

  it('rejects empty items array', async () => {
    const emptyDto = plainToInstance(CreateRequisitionPurchaseOrderDto, {
      vendorId: '550e8400-e29b-41d4-a716-446655440000',
      items: [],
    });
    const messages = collectConstraintMessages(await validate(emptyDto));
    expect(messages.length).toBeGreaterThan(0);
    expect(messages).toEqual(
      expect.arrayContaining([expect.stringMatching(/should not be empty/i)]),
    );
  });
});
