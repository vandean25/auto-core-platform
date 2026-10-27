import { cn } from '@/lib/utils'

export type DataTableFilterMeta =
  | {
      type: 'faceted'
      title: string
      /** `count` is shown next to the option when the server can supply it. */
      options: { value: string; label: string; count?: number }[]
    }
  | { type: 'dateRange'; title: string }

export type DataTableMobileRole = 'title' | 'subtitle' | 'status' | 'trailing' | 'hidden'

export type DataTableMobileSlots = Partial<Record<Exclude<DataTableMobileRole, 'hidden'>, string>>

type DataTableColumnMeta = {
  /** Slot of this column in the phone list mode (below md). Unannotated lists fall back to their first two data columns. */
  mobile?: DataTableMobileRole
  /** Adds a filter control to the toolbar. The value is a string, so it survives the URL round trip. */
  filter?: DataTableFilterMeta
  /** Right-aligned with tabular figures. */
  numeric?: boolean
}

export function getDataTableColumnMeta(columnDef: { meta?: unknown }): DataTableColumnMeta {
  return (columnDef.meta as DataTableColumnMeta | undefined) ?? {}
}

/** Filter values are comma-joined strings: `a,b` for a facet, `2026-01-01,2026-01-31` for a date range. */
export function splitFilterValue(value: unknown): string[] {
  return typeof value === 'string' && value ? value.split(',') : []
}

export function getDataTableHeadClassName(columnDef: { meta?: unknown }): string | undefined {
  return getDataTableColumnMeta(columnDef).numeric ? 'text-right [&>div]:justify-end' : undefined
}

export function getDataTableCellClassName(columnDef: { meta?: unknown }, clickable: boolean): string | undefined {
  return cn(clickable && 'cursor-pointer', getDataTableColumnMeta(columnDef).numeric && 'text-right tabular-nums') || undefined
}

/** Maps column ids to list-mode slots: the first column per `meta.mobile` role wins; without any role the first two data columns become title and subtitle. */
export function getDataTableMobileSlots(
  columns: { id: string; accessorFn?: unknown; columnDef: { meta?: unknown } }[],
): DataTableMobileSlots {
  const candidates = columns.filter(
    (column) => column.id !== 'select' && getDataTableColumnMeta(column.columnDef).mobile !== 'hidden',
  )
  const slots: DataTableMobileSlots = {}
  for (const column of candidates) {
    const role = getDataTableColumnMeta(column.columnDef).mobile
    if (role && role !== 'hidden') slots[role] ??= column.id
  }

  const used = new Set(Object.values(slots))
  const dataColumns = candidates.filter((column) => column.accessorFn !== undefined && !used.has(column.id))
  slots.title ??= dataColumns.shift()?.id
  if (used.size === 0) slots.subtitle ??= dataColumns.shift()?.id
  return slots
}
