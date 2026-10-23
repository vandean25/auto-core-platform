import {
  filterEntityActions,
  type EntityActionDefinition,
} from '@/features/actions/entity-action'
import { RegistryActionButton } from '@/features/actions/RegistryActionButton'

type EntityPeekActionButtonsProps<TRecord extends object, TRunContext> = {
  definitions: EntityActionDefinition<TRecord, TRunContext>[]
  role: string | undefined
  record: TRecord
  runContext: TRunContext
}

export function EntityPeekActionButtons<TRecord extends object, TRunContext>({
  definitions,
  role,
  record,
  runContext,
}: EntityPeekActionButtonsProps<TRecord, TRunContext>) {
  const actions = filterEntityActions(definitions, role, record)

  if (actions.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-2">
      {actions.map((definition) => (
        <RegistryActionButton
          key={definition.id}
          action={definition}
          role={role}
          record={record}
          runContext={runContext}
          className="min-h-11 w-full justify-start"
        />
      ))}
    </div>
  )
}
