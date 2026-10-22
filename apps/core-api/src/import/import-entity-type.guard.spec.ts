import { ImportEntityType } from '@prisma/client';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import {
  assertImplementedImportEntityType,
  parseImportEntityType,
} from './import-entity-type.guard.js';

describe('import type handler registry', () => {
  it('accepts implemented import entity types', () => {
    for (const entityType of [
      ImportEntityType.CUSTOMER,
      ImportEntityType.LABOR_OPERATION,
      ImportEntityType.VEHICLE_PARTY,
      ImportEntityType.VEHICLE_DUE_DATE,
    ]) {
      expect(parseImportEntityType(entityType)).toBe(entityType);
      expect(() => assertImplementedImportEntityType(entityType)).not.toThrow();
    }
  });

  it('rejects schema-only import entity types with IMPORT_INVALID_ENTITY_TYPE', () => {
    for (const entityType of [
      ImportEntityType.PART,
      ImportEntityType.LABOR_PRICE_GROUP,
      ImportEntityType.LEGACY_INVOICE,
    ]) {
      expect(() => parseImportEntityType(entityType)).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({
            code: IMPORT_ERROR_CODES.INVALID_ENTITY_TYPE,
          }),
        }),
      );
      expect(() => assertImplementedImportEntityType(entityType)).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({
            code: IMPORT_ERROR_CODES.INVALID_ENTITY_TYPE,
          }),
        }),
      );
    }
  });

  it('rejects unknown entity type strings', () => {
    expect(() => parseImportEntityType('NOT_A_REAL_TYPE')).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({
          code: IMPORT_ERROR_CODES.INVALID_ENTITY_TYPE,
        }),
      }),
    );
  });
});
