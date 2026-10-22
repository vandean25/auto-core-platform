import type { LucideIcon } from 'lucide-react'

import type { DataTableRowContextAction } from '@/components/data-table/data-table-context-menu'

export type EntityActionDefinition<TRecord, TRunContext> = {
  id: string
  label: string
  icon?: LucideIcon
  /** Single-letter shortcut when a list row is focused (AUT-694). */
  shortcutKey?: string
  destructive?: boolean
  isAllowedForRole: (role: string | undefined) => boolean
  isEnabled: (record: TRecord) => boolean
  run: (record: TRecord, context: TRunContext) => void | Promise<void>
}

export function filterEntityActions<TRecord extends object, TRunContext>(
  definitions: EntityActionDefinition<TRecord, TRunContext>[],
  role: string | undefined,
  record: TRecord,
): EntityActionDefinition<TRecord, TRunContext>[] {
  return definitions.filter(
    (definition) => definition.isAllowedForRole(role) && definition.isEnabled(record),
  )
}

export function toDataTableContextActions<TRecord extends object, TRunContext>(
  definitions: EntityActionDefinition<TRecord, TRunContext>[],
  role: string | undefined,
  record: TRecord,
  runContext: TRunContext,
): DataTableRowContextAction<TRecord>[] {
  return filterEntityActions(definitions, role, record).map((definition) => ({
    label: definition.label,
    destructive: definition.destructive,
    onClick: () => {
      void definition.run(record, runContext)
    },
  }))
}
