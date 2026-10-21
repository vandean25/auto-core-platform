import deEnums from '../../../../../locales/de/enums.json'

/** Wire values rendered through `enums:status.*` (StatusBadge and shared status UI). */
export type StatusEnumValue = keyof typeof deEnums.status

export const STATUS_ENUM_VALUES = Object.keys(deEnums.status) as StatusEnumValue[]

export type ImportEntityTypeUi = keyof typeof deEnums.importEntityType

export const IMPORT_ENTITY_TYPE_VALUES = Object.keys(
  deEnums.importEntityType,
) as ImportEntityTypeUi[]

export type DataTableColumnId = keyof typeof deEnums.dataTableColumn

export const DATA_TABLE_COLUMN_IDS = Object.keys(deEnums.dataTableColumn) as DataTableColumnId[]

export function importFieldSegmentForEntity(entityType: ImportEntityTypeUi): keyof typeof deEnums.importField {
  if (entityType === 'VEHICLE') return 'vehicle'
  if (entityType === 'SUPPLIER_PRICE_LIST') return 'supplierPriceList'
  if (entityType === 'LABOR_OPERATION') return 'laborOperation'
  return 'customer'
}
