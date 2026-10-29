import type { components } from '@/api/generated/openapi'

import deEnums from '../../../../../locales/de/enums.json'

/** Wire values rendered through `enums:status.*` (StatusBadge and shared status UI). */
export type StatusEnumValue = keyof typeof deEnums.status

export const STATUS_ENUM_VALUES = Object.keys(deEnums.status) as StatusEnumValue[]

export type ImplementedImportEntityType = components['schemas']['ImplementedImportEntityType']

type ImportEntityTypeEntry = components['schemas']['ImportEntityTypeResponseDto']

/** Entity types with wizard field definitions, keyed to their `enums:importField.*` segment. */
const IMPORT_FIELD_SEGMENTS = {
  CUSTOMER: 'customer',
  VEHICLE: 'vehicle',
  SUPPLIER_PRICE_LIST: 'supplierPriceList',
  LABOR_OPERATION: 'laborOperation',
} as const satisfies Partial<Record<ImplementedImportEntityType, keyof typeof deEnums.importField>>

export type ImportEntityTypeUi = keyof typeof IMPORT_FIELD_SEGMENTS

export class UnknownImportEntityTypeError extends Error {
  readonly entityType: string

  constructor(entityType: string) {
    super(`Import entity type without wizard field definitions: ${entityType}`)
    this.name = 'UnknownImportEntityTypeError'
    this.entityType = entityType
  }
}

export function isImportEntityTypeUi(value: string): value is ImportEntityTypeUi {
  return Object.hasOwn(IMPORT_FIELD_SEGMENTS, value)
}

export function toImportEntityTypeUi(value: string): ImportEntityTypeUi {
  if (!isImportEntityTypeUi(value)) {
    throw new UnknownImportEntityTypeError(value)
  }
  return value
}

/** Wizard entity types of the core-api registry, in registry order. */
export function wizardImportEntityTypes(entries: readonly ImportEntityTypeEntry[]): ImportEntityTypeUi[] {
  return entries.filter((entry) => entry.wizard).map((entry) => toImportEntityTypeUi(entry.entity_type))
}

export type DataTableColumnId = keyof typeof deEnums.dataTableColumn

export const DATA_TABLE_COLUMN_IDS = Object.keys(deEnums.dataTableColumn) as DataTableColumnId[]

export function importFieldSegmentForEntity(entityType: ImportEntityTypeUi): keyof typeof deEnums.importField {
  return IMPORT_FIELD_SEGMENTS[entityType]
}
