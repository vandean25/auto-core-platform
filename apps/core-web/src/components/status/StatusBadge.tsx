import { cn } from '@/lib/utils'

interface StatusBadgeProps {
  status: string
  label?: string
  className?: string
}

const statusClassMap: Record<string, string> = {
  DRAFT: 'border-slate-200 bg-slate-100 text-slate-700',
  SCHEDULED: 'border-slate-200 bg-slate-100 text-slate-700',
  SENT: 'border-indigo-200 bg-indigo-100 text-indigo-700',
  INTAKE: 'border-blue-200 bg-blue-100 text-blue-700',
  CONFIRMED: 'border-blue-200 bg-blue-100 text-blue-700',
  IN_PROGRESS: 'border-amber-200 bg-amber-100 text-amber-700',
  WAITING_PARTS: 'border-amber-200 bg-amber-100 text-amber-700',
  PARTIAL: 'border-amber-200 bg-amber-100 text-amber-700',
  COMPLETED: 'border-emerald-200 bg-emerald-100 text-emerald-700',
  DONE: 'border-emerald-200 bg-emerald-100 text-emerald-700',
  INVOICED: 'border-violet-200 bg-violet-100 text-violet-700',
  FINALIZED: 'border-violet-200 bg-violet-100 text-violet-700',
  ISSUED: 'border-violet-200 bg-violet-100 text-violet-700',
  POSTED: 'border-indigo-200 bg-indigo-100 text-indigo-700',
  PAID: 'border-emerald-200 bg-emerald-100 text-emerald-700',
  CANCELLED: 'border-rose-200 bg-rose-100 text-rose-700',
  OUT_OF_STOCK: 'border-rose-200 bg-rose-100 text-rose-700',
  IN_STOCK: 'border-emerald-200 bg-emerald-100 text-emerald-700',
  SUPERSEDED: 'border-amber-200 bg-amber-100 text-amber-700',
  ACTIVE: 'border-emerald-200 bg-emerald-100 text-emerald-700',
  INACTIVE: 'border-slate-200 bg-slate-100 text-slate-500',
  // Parts status
  READY: 'border-emerald-200 bg-emerald-100 text-emerald-700',
  SHORTAGE: 'border-rose-200 bg-rose-100 text-rose-700',
  WAITING: 'border-amber-200 bg-amber-100 text-amber-700',
  NO_PARTS: 'border-slate-200 bg-slate-100 text-slate-500',
}

export function formatStatusLabel(status: string) {
  return status
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium leading-none',
        statusClassMap[status] ?? 'border-slate-200 bg-slate-100 text-slate-700',
        className,
      )}
    >
      {label ?? formatStatusLabel(status)}
    </span>
  )
}

