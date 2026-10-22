import { cn } from '@/lib/utils'

export type DataTableFilterMeta =
  | {
      type: 'faceted'
      title: string
      /** `count` is shown next to the option when the server can supply it. */
      options: { value: string; label: string; count?: number }[]
    }
  | { type: 'dateRange'; title: string }

type DataTableColumnMeta = {
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
