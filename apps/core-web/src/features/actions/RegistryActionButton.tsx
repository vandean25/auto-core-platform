import type { ComponentProps } from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { executeEntityAction, type EntityActionDefinition } from './entity-action'

function ActionButtonIcon<TRecord, TRunContext>({
  action,
  showIcon,
  loading,
}: {
  action: EntityActionDefinition<TRecord, TRunContext>
  showIcon: boolean
  loading: boolean
}) {
  const Icon = loading ? Loader2 : showIcon ? action.icon : undefined
  if (!Icon) {
    return null
  }
  return (
    <Icon
      className={cn('mr-2 h-4 w-4 shrink-0', loading && 'animate-spin')}
      aria-hidden="true"
    />
  )
}

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
  /** Shows a spinner and disables the button while an async action is in flight. */
  loading?: boolean
}

export function RegistryActionButton<TRecord, TRunContext>({
  action,
  record,
  runContext,
  role,
  label,
  showIcon = true,
  loading = false,
  variant,
  disabled,
  ...buttonProps
}: RegistryActionButtonProps<TRecord, TRunContext>) {
  if (!action.isAllowedForRole(role) || !action.isEnabled(record)) {
    return null
  }

  return (
    <Button
      type="button"
      data-action-id={action.id}
      variant={variant ?? (action.destructive ? 'destructive' : 'outline')}
      disabled={disabled || loading}
      onClick={() => {
        executeEntityAction(action, record, runContext)
      }}
      {...buttonProps}
    >
      <ActionButtonIcon action={action} showIcon={showIcon} loading={loading} />
      {label ?? action.label}
    </Button>
  )
}
