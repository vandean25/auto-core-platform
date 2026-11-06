import { useEffect, useMemo } from 'react'

import {
  executeEntityAction,
  filterEntityActions,
  type EntityActionDefinition,
} from '@/features/actions/entity-action'
import { registerShortcutHelpEntries } from './shortcut-help-entries'
import { useShortcutHandler } from './shortcut-dispatcher'
import { getFocusedDataTableRowId } from './shortcut-guard'

type RegistryRowShortcutsArgs<TRecord extends { id: string }, TRunContext> = {
  role: string | undefined
  definitions: EntityActionDefinition<TRecord, TRunContext>[]
  runContext: TRunContext
  records: TRecord[]
}

export function useRegistryRowShortcuts<TRecord extends { id: string }, TRunContext>(
  args: RegistryRowShortcutsArgs<TRecord, TRunContext>,
): void {
  const { role, definitions, runContext, records } = args

  const recordById = useMemo(
    () => new Map(records.map((record) => [record.id, record])),
    [records],
  )

  useEffect(
    () =>
      registerShortcutHelpEntries(
        definitions
          .filter((definition) => definition.shortcutKey)
          .map((definition) => ({
            id: definition.id,
            keys: [definition.shortcutKey!.toUpperCase()],
            label: definition.label,
          })),
      ),
    [definitions],
  )

  useShortcutHandler('row', (key, event) => {
    if (event.repeat) {
      return false
    }
    const rowId = getFocusedDataTableRowId()
    const record = rowId ? recordById.get(rowId) : undefined
    if (!record) {
      return false
    }
    // Same predicates as the context menu and Cmd+K: role and per-record enabled state.
    const action = filterEntityActions(definitions, role, record).find(
      (definition) => definition.shortcutKey?.toLowerCase() === key,
    )
    if (!action) {
      return false
    }
    executeEntityAction(action, record, runContext)
    return true
  })
}
