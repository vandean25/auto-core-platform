import { useMemo } from 'react'
import type { LegacyColumnDef } from '@tanstack/react-table/legacy'
import { useTranslation } from 'react-i18next'
import { useAuthSession } from '@/api/auth-session'
import { useCustomFieldDefinitions, type CustomFieldDefinition, type CustomFieldEntity } from '@/api/custom-fields'
import { useDataTableUrl } from '@/hooks/use-data-table-url'
import { formatDate, formatNumber } from '@/lib/format'

const NO_DEFINITIONS: CustomFieldDefinition[] = []

function ownsFilter(name: string, definition: CustomFieldDefinition) {
  const id = `cf.${definition.key}`
  return name === id || name.startsWith(`${id}[`)
}

export function useCustomFieldList<Row extends { custom_fields?: Record<string, unknown> }>(entity: CustomFieldEntity) {
  const { data: session } = useAuthSession()
  const enabled = session?.customFieldsEnabled === true
  const { data } = useCustomFieldDefinitions(entity, { enabled })
  const definitions = useMemo(() => enabled && data ? data.filter((definition) => !definition.archived) : NO_DEFINITIONS, [enabled, data])
  const { t } = useTranslation('common')
  const { searchParams, updateSearch } = useDataTableUrl()
  const columns = useMemo<LegacyColumnDef<Row>[]>(() => definitions.map((definition) => ({
    id: `cf.${definition.key}`,
    header: definition.label,
    meta: { defaultHidden: true, mobile: 'additional' },
    enableSorting: false,
    accessorFn: (row) => {
      const values = row.custom_fields
      const value = values && Object.hasOwn(values, definition.key) ? values[definition.key] : undefined
      if (typeof value === 'boolean') return value ? t('customFields.booleanYes') : t('customFields.booleanNo')
      if (typeof value === 'number') return formatNumber(value, { maximumFractionDigits: 20 })
      if (typeof value === 'string') return definition.type === 'DATE' ? formatDate(value) : value
      return ''
    },
  })), [definitions, t])

  const filters = new URLSearchParams([...searchParams].filter(([name]) => definitions.some((definition) => ownsFilter(name, definition))))
  filters.sort()
  const params = Object.fromEntries([...new Set(filters.keys())].map((name) => [name, filters.getAll(name)]))

  function apply(nextFilters: URLSearchParams) {
    updateSearch((current) => {
      const next = new URLSearchParams(current)
      for (const name of current.keys()) {
        if (definitions.some((definition) => ownsFilter(name, definition))) next.delete(name)
      }
      for (const [name, value] of nextFilters) next.append(name, value)
      next.delete('page')
      return { next, replace: false }
    })
  }

  return { definitions, columns, filters, params, apply }
}
