import { Button } from '@/components/ui/button'
import {
  filterEntityActions,
  type EntityActionDefinition,
} from '@/features/actions/entity-action'

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
      {actions.map((definition) => {
        const Icon = definition.icon
        return (
          <Button
            key={definition.id}
            type="button"
            variant={definition.destructive ? 'destructive' : 'outline'}
            className="min-h-11 w-full justify-start"
            onClick={() => {
              void definition.run(record, runContext)
            }}
          >
            {Icon ? <Icon className="mr-2 h-4 w-4 shrink-0" aria-hidden /> : null}
            {definition.label}
          </Button>
        )
      })}
    </div>
  )
}
