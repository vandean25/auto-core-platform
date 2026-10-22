import { BadRequestException } from '@nestjs/common';
import { ImportEntityType } from '@prisma/client';
import { IMPORT_ERROR_CODES } from './import.constants.js';

/** Import entity types with CSV handlers wired in ImportService. */
export const IMPLEMENTED_IMPORT_ENTITY_TYPES = [
  ImportEntityType.CUSTOMER,
  ImportEntityType.VEHICLE,
  ImportEntityType.SUPPLIER_PRICE_LIST,
  ImportEntityType.LABOR_OPERATION,
  ImportEntityType.VEHICLE_PARTY,
  ImportEntityType.VEHICLE_DUE_DATE,
] as const;

export type ImplementedImportEntityType =
  (typeof IMPLEMENTED_IMPORT_ENTITY_TYPES)[number];

const implementedImportEntityTypeSet = new Set<string>(
  IMPLEMENTED_IMPORT_ENTITY_TYPES,
);

const allImportEntityTypes = new Set<string>(Object.values(ImportEntityType));

function isImportEntityType(value: string): value is ImportEntityType {
  return allImportEntityTypes.has(value);
}

export function importInvalidEntityTypeError(value: string) {
  return new BadRequestException({
    code: IMPORT_ERROR_CODES.INVALID_ENTITY_TYPE,
    message: `Invalid entity type: ${value}`,
  });
}

export function assertImplementedImportEntityType(
  entityType: ImportEntityType,
): asserts entityType is ImplementedImportEntityType {
  if (!implementedImportEntityTypeSet.has(entityType)) {
    throw importInvalidEntityTypeError(entityType);
  }
}

/** Parses a request entity type and rejects unimplemented enum values. */
export function parseImportEntityType(value: string): ImportEntityType {
  const normalized = value?.trim().toUpperCase();
  if (!normalized || !isImportEntityType(normalized)) {
    throw importInvalidEntityTypeError(value);
  }
  assertImplementedImportEntityType(normalized);
  return normalized;
}
