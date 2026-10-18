import { ImportEntityType } from '@prisma/client';
import { LaborOperationImportHandler } from './labor-operation-import.handler.js';

describe('LaborOperationImportHandler', () => {
  it('registers the LABOR_OPERATION entity type', () => {
    const handler = new LaborOperationImportHandler(
      {} as never,
      {} as never,
      {} as never,
    );
    expect(handler.entityType).toBe(ImportEntityType.LABOR_OPERATION);
  });
});
