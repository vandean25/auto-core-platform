import { plainToInstance } from 'class-transformer';
import { ValidationError, validate } from 'class-validator';
import {
  UpdateWorkshopInspectionDto,
  UpdateWorkshopInspectionItemDto,
} from './update-workshop-inspection.dto.js';

const ITEM_ID = '2f1f9d2a-6f9b-4f0b-9a5f-3d0c9b1e2a11';

function failedProperties(errors: ValidationError[]): string[] {
  return errors.flatMap((error) =>
    error.children?.length ? failedProperties(error.children) : [error.property],
  );
}

async function failingItemProperties(notes: string | null): Promise<string[]> {
  const instance = plainToInstance(UpdateWorkshopInspectionItemDto, { id: ITEM_ID, notes });
  return (await validate(instance)).map((error) => error.property);
}

describe('max length on workshop inspection item notes (AUT-732)', () => {
  it('refuses notes longer than 2000 characters', async () => {
    expect(await failingItemProperties('x'.repeat(2001))).toEqual(['notes']);
  });

  it('accepts notes at the 2000 character limit', async () => {
    expect(await failingItemProperties('x'.repeat(2000))).toEqual([]);
  });

  it('still accepts a null note that clears the field', async () => {
    expect(await failingItemProperties(null)).toEqual([]);
  });

  it('rejects an over-long note nested inside the parent update payload', async () => {
    const instance = plainToInstance(UpdateWorkshopInspectionDto, {
      items: [{ id: ITEM_ID, notes: 'x'.repeat(2001) }],
    });
    expect(failedProperties(await validate(instance))).toEqual(['notes']);
  });
});
