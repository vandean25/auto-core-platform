import { useMemo } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import {
  executeEntityAction,
  filterEntityActions,
  type EntityActionDefinition,
} from '@/features/actions/entity-action'
import {
  getFocusedDataTableRowId,
  isRowShortcutEnabled,
} from './shortcut-guard'

type RegistryRowShortcutsArgs<TRecord extends { id: string }, TRunContext> = {
  role: string | undefined
  definitions: EntityActionDefinition<TRecord, TRunContext>[]
  runContext: TRunContext
  records: TRecord[]
}

function collectShortcutKeys<TRecord extends object, TRunContext>(
  definitions: EntityActionDefinition<TRecord, TRunContext>[],
): string[] {
  const keys = new Set<string>()
  for (const definition of definitions) {
    if (definition.shortcutKey) {
      keys.add(definition.shortcutKey)
    }
  }
  return [...keys]
}

export function useRegistryRowShortcuts<TRecord extends { id: string }, TRunContext>(
  args: RegistryRowShortcutsArgs<TRecord, TRunContext>,
): void {
  const { role, definitions, runContext, records } = args

  const recordById = useMemo(
    () => new Map(records.map((record) => [record.id, record])),
    [records],
  )

  const shortcutKeys = useMemo(() => collectShortcutKeys(definitions), [definitions])

  useHotkeys(
    shortcutKeys,
    (event) => {
      const rowId = getFocusedDataTableRowId()
      if (!rowId) {
        return
      }
      const record = recordById.get(rowId)
      if (!record) {
        return
      }
      const pressedKey = event.key.toLowerCase()
      const allowed = filterEntityActions(definitions, role, record)
      const action = allowed.find(
        (definition) => definition.shortcutKey?.toLowerCase() === pressedKey,
      )
      if (!action) {
        return
      }
      event.preventDefault()
      executeEntityAction(action, record, runContext)
    },
    {
      enabled: (event) => isRowShortcutEnabled(event) && shortcutKeys.length > 0,
      ignoreEventWhen: (event) => event.repeat,
      preventDefault: true,
    },
    [definitions, recordById, role, runContext, shortcutKeys],
  )
}
