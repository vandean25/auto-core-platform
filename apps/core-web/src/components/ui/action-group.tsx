import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export interface SecondaryAction {
  label: string
  icon?: ReactNode
  onClick: () => void
  variant?: 'default' | 'destructive'
  disabled?: boolean
  separator?: boolean // renders a separator BEFORE this item
}

export interface ActionGroupProps {
  /** The primary action button. Its right-side border radius is overridden to produce the split effect. */
  primaryAction: ReactNode
  /** List of items to show in the secondary dropdown */
  secondaryActions: SecondaryAction[]
  /** Alignment of the dropdown (default: end) */
  align?: 'start' | 'center' | 'end'
  /** Extra class names on the outer wrapper */
  className?: string
}

/**
 * ActionGroup – a "split button" that pairs a primary CTA with a secondary
 * dropdown of contextual actions, separated by a 1px vertical divider.
 *
 * Keyboard accessible: the chevron trigger participates in the normal tab
 * sequence and the Radix DropdownMenu handles arrow-key navigation with
 * loop enabled.
 */
export function ActionGroup({
  primaryAction,
  secondaryActions,
  align = 'end',
  className,
}: ActionGroupProps) {
  return (
    <div className={cn('flex items-stretch', className)}>
      {/* Primary action – override right border-radius to merge with trigger */}
      <div className='[&>button]:rounded-r-none [&>button]:border-r-0'>{primaryAction}</div>

      {/* 1px visual divider */}
      <div className='w-px bg-primary/30 self-stretch' />

      {/* Chevron trigger */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant='default'
            size='default'
            className='rounded-l-none px-2'
            aria-label='More actions'
          >
            <ChevronDown className='h-4 w-4' aria-hidden='true' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} loop>
          {secondaryActions.map((action, idx) => (
            <div key={idx}>
              {action.separator && <DropdownMenuSeparator />}
              <DropdownMenuItem
                onClick={action.onClick}
                disabled={action.disabled}
                className={
                  action.variant === 'destructive'
                    ? 'text-destructive focus:text-destructive'
                    : undefined
                }
              >
                {action.icon && (
                  <span className='mr-2 flex h-4 w-4 items-center justify-center'>
                    {action.icon}
                  </span>
                )}
                {action.label}
              </DropdownMenuItem>
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
