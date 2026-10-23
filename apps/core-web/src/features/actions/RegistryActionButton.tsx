import type { ComponentProps } from 'react'

import { Button } from '@/components/ui/button'
import { executeEntityAction, type EntityActionDefinition } from './entity-action'

export type RegistryActionButtonProps<TRecord, TRunContext> = Omit<
  ComponentProps<typeof Button>,
  'onClick' | 'children'
> & {
  action: EntityActionDefinition<TRecord, TRunContext>
  record: TRecord
  runContext: TRunContext
  role: string | undefined
  label?: string
  showIcon?: boolean
}

export function RegistryActionButton<TRecord, TRunContext>({
  action,
  record,
  runContext,
  role,
  label,
  showIcon = true,
  variant,
  ...buttonProps
}: RegistryActionButtonProps<TRecord, TRunContext>) {
  if (!action.isAllowedForRole(role) || !action.isEnabled(record)) {
    return null
  }

  const Icon = showIcon ? action.icon : undefined

  return (
    <Button
      type="button"
      data-action-id={action.id}
      variant={variant ?? (action.destructive ? 'destructive' : 'outline')}
      onClick={() => {
        executeEntityAction(action, record, runContext)
      }}
      {...buttonProps}
    >
      {Icon ? <Icon className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" /> : null}
      {label ?? action.label}
    </Button>
  )
}
