import { plainToInstance } from 'class-transformer';
import { ValidationError, validate } from 'class-validator';
import { INSPECTION_NOTES_MAX_LENGTH } from '../../workshop/workshop-inspection-limits.js';
import { InspectionItemValueDto, SaveDiagnosticsDto } from './save-diagnostics.dto.js';

const ITEM_ID = '2f1f9d2a-6f9b-4f0b-9a5f-3d0c9b1e2a11';

function failedProperties(errors: ValidationError[]): string[] {
  return errors.flatMap((error) =>
    error.children?.length ? failedProperties(error.children) : [error.property],
  );
}

async function failingItemProperties(notes: string | null): Promise<string[]> {
  const instance = plainToInstance(InspectionItemValueDto, { itemId: ITEM_ID, notes });
  return (await validate(instance)).map((error) => error.property);
}

describe('max length on the mechanic diagnostics notes (AUT-732)', () => {
  it('refuses notes longer than the inspection limit', async () => {
    expect(await failingItemProperties('x'.repeat(INSPECTION_NOTES_MAX_LENGTH + 1))).toEqual([
      'notes',
    ]);
  });

  it('accepts notes at the inspection limit', async () => {
    expect(await failingItemProperties('x'.repeat(INSPECTION_NOTES_MAX_LENGTH))).toEqual([]);
  });

  it('still accepts a null note that clears the field', async () => {
    expect(await failingItemProperties(null)).toEqual([]);
  });

  it('rejects an over-long note nested inside the diagnostics payload', async () => {
    const instance = plainToInstance(SaveDiagnosticsDto, {
      inspectionId: ITEM_ID,
      inspectionItems: [{ itemId: ITEM_ID, notes: 'x'.repeat(INSPECTION_NOTES_MAX_LENGTH + 1) }],
    });
    expect(failedProperties(await validate(instance))).toEqual(['notes']);
  });
});
