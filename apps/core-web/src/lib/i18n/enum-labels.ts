import { useTranslation } from 'react-i18next'
import type { TOptions } from 'i18next'

import {
  importFieldSegmentForEntity,
  type DataTableColumnId,
  type ImplementedImportEntityType,
  type ImportEntityTypeUi,
} from './enum-registry'
import { i18n } from './init-i18n'

type EnumsTFunction = (key: string, options?: TOptions) => string

function enumsT(): EnumsTFunction {
  return i18n.getFixedT(i18n.language, 'enums') as EnumsTFunction
}

export function translateEnum(...parts: string[]): string {
  return enumsT()(parts.join('.'))
}

export function translateEnumOptions(parts: string[], options?: TOptions): string {
  return enumsT()(parts.join('.'), options)
}

/** Localized label for a shared status wire value (`enums:status.<VALUE>`). */
export function formatStatusLabel(status: string): string {
  return translateEnum('status', status)
}

/**
 * `formatStatusLabel` for components: subscribes to the UI language, so a badge that only renders a
 * wire value re-renders in the new language instead of keeping the label of the previous one.
 */
export function useStatusLabel(status: string): string {
  // Subscribes the component to `languageChanged`; the label itself is read from the active language.
  useTranslation('enums')
  return formatStatusLabel(status)
}

export function formatInventoryTransactionType(type: string): string {
  return translateEnum('inventoryTransactionType', type)
}

export function formatAttendanceEventType(type: string): string {
  return translateEnum('attendanceEventType', type)
}

export function formatAttendanceSource(source: string): string {
  return translateEnum('attendanceSource', source)
}

/** Localized label for a workshop member role (`enums:tenantMemberRole.<ROLE>`); an unknown role shows as sent. */
export function formatTenantMemberRole(role: string): string {
  return enumsT()(`tenantMemberRole.${role}`, { defaultValue: role })
}

export function formatImportEntityTypeLabel(entityType: ImplementedImportEntityType): string {
  return translateEnum('importEntityType', entityType)
}

export function formatImportFieldLabel(entityType: ImportEntityTypeUi, fieldKey: string): string {
  const segment = importFieldSegmentForEntity(entityType)
  return translateEnum('importField', segment, fieldKey)
}

export function formatDataTableColumnId(columnId: string): string {
  return translateEnum('dataTableColumn', columnId as DataTableColumnId)
}
