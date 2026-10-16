import type { TOptions } from 'i18next'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import {
  importFieldSegmentForEntity,
  type DataTableColumnId,
  type ImportEntityTypeUi,
  type StatusEnumValue,
} from './enum-registry'
import { i18n } from './init-i18n'

type EnumsTFunction = (key: string, options?: TOptions) => string

function enumsT(): EnumsTFunction {
  return i18n.getFixedT(i18n.language, 'enums') as EnumsTFunction
}

export function enumTranslationKey(...parts: string[]): string {
  return `enums:${parts.join('.')}`
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

export function formatStatusLabelTyped(status: StatusEnumValue): string {
  return formatStatusLabel(status)
}

export function formatImportEntityTypeLabel(entityType: ImportEntityTypeUi): string {
  return translateEnum('importEntityType', entityType)
}

export function formatImportFieldLabel(entityType: ImportEntityTypeUi, fieldKey: string): string {
  const segment = importFieldSegmentForEntity(entityType)
  return translateEnum('importField', segment, fieldKey)
}

export function formatDataTableColumnId(columnId: string): string {
  return translateEnum('dataTableColumn', columnId as DataTableColumnId)
}

export function useEnumLabel() {
  const { t } = useTranslation('enums')

  const label = useCallback(
    (...parts: string[]) => t(parts.join('.') as 'status.DRAFT'),
    [t],
  )

  const statusLabel = useCallback(
    (status: StatusEnumValue) => t(`status.${status}` as 'status.DRAFT'),
    [t],
  )

  return { label, statusLabel, formatStatusLabel: statusLabel }
}
