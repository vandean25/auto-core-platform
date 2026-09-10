import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { WorkshopLineItemType } from '@prisma/client';
import { ReplaceWorkshopTaskLineItemsDto } from './replace-workshop-task-line-items.dto';

async function validateQuantity(qty: number) {
  const dto = plainToInstance(ReplaceWorkshopTaskLineItemsDto, {
    expectedLineItemsVersion: 0,
    items: [
      {
        type: WorkshopLineItemType.PART,
        itemNo: 'PAD-1',
        description: 'Brake pad',
        qty,
        unitPrice: 10,
      },
    ],
  });

  return validate(dto);
}

describe('ReplaceWorkshopTaskLineItemsDto', () => {
  it.each([1.5, 0.001])('accepts quantity %s', async (qty) => {
    await expect(validateQuantity(qty)).resolves.toEqual([]);
  });

  it('rejects more than three decimal places', async () => {
    const errors = await validateQuantity(1.0001);

    expect(errors[0]?.children?.[0]?.children?.[0]?.constraints).toEqual(
      expect.objectContaining({ isNumber: expect.any(String) }),
    );
  });

  it('rejects zero', async () => {
    const errors = await validateQuantity(0);

    expect(errors[0]?.children?.[0]?.children?.[0]?.constraints).toEqual(
      expect.objectContaining({ min: expect.any(String) }),
    );
  });

  it('rejects negative quantities', async () => {
    const errors = await validateQuantity(-1);

    expect(errors[0]?.children?.[0]?.children?.[0]?.constraints).toEqual(
      expect.objectContaining({ min: expect.any(String) }),
    );
  });
});
