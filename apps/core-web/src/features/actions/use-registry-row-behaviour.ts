import { useMemo } from 'react'

import type { DataTableRowBehaviour } from '@/components/data-table/data-table-row-behaviour'
import {
  type EntityActionDefinition,
  toDataTableContextActions,
} from './entity-action'

type RegistryRowBehaviourArgs<TRecord extends object, TRunContext> = {
  role: string | undefined
  definitions: EntityActionDefinition<TRecord, TRunContext>[]
  runContext: TRunContext
  tableBehaviour?: Omit<DataTableRowBehaviour<TRecord>, 'getRowContextActions'>
}

export function useRegistryRowBehaviour<TRecord extends object, TRunContext>(
  args: RegistryRowBehaviourArgs<TRecord, TRunContext>,
): DataTableRowBehaviour<TRecord> {
  const { role, definitions, runContext, tableBehaviour } = args

  return useMemo(
    () => ({
      ...tableBehaviour,
      getRowContextActions: (row) =>
        toDataTableContextActions(definitions, role, row, runContext),
    }),
    [definitions, role, runContext, tableBehaviour],
  )
}
