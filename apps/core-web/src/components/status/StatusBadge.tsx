import { formatStatusLabel } from '@/lib/i18n/enum-labels'
import { cn } from '@/lib/utils'
import { NEUTRAL, statusClassMap } from './status-class-map'

export { formatStatusLabel }

interface StatusBadgeProps {
  status: string
  label?: string
  className?: string
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium leading-none',
        statusClassMap[status] ?? NEUTRAL,
        className,
      )}
    >
      {label ?? formatStatusLabel(status)}
    </span>
  )
}
