import { flexRender } from '@tanstack/react-table'
import { MoreHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { getTableRowId, type DataTableBodyRowModel } from './data-table-body-row'
import { getDataTableMobileSlots, type DataTableMobileSlots } from './data-table-column-meta'
import type { DataTableRowBehaviour } from './data-table-row-behaviour'

type DataTableListProps<TData extends object> = {
  columns: Parameters<typeof getDataTableMobileSlots>[0]
  rows: DataTableBodyRowModel<TData>[]
  rowBehaviour?: DataTableRowBehaviour<TData>
}

const rowPrimaryClassName = 'flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 pl-3 text-left'

function TappableRow({ onActivate, children }: { onActivate: () => void; children: ReactNode }) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(rowPrimaryClassName, 'cursor-pointer')}
      onClick={(event) => {
        // Controls rendered inside a cell keep their own behaviour.
        if (!(event.target as Element).closest('button, a, input, select, textarea')) onActivate()
      }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onActivate()
        }
      }}
    >
      {children}
    </div>
  )
}

function DataTableRowActions<TData extends object>({
  row,
  rowBehaviour,
}: {
  row: TData
  rowBehaviour?: DataTableRowBehaviour<TData>
}) {
  const { t } = useTranslation('common')
  const actions = rowBehaviour?.getRowContextActions?.(row) ?? []
  if (actions.length === 0) return null
  const name = rowBehaviour?.getRowAccessibleName?.(row)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-11 shrink-0" aria-label={name ? t('dataTable.rowActionsFor', { name }) : t('dataTable.rowActions')}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.id ?? action.label}
            data-action-id={action.id}
            className={cn('min-h-11', action.destructive && 'text-destructive focus:text-destructive')}
            onSelect={() => action.onClick(row)}
          >
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ListRowContent({ title, subtitle, status, trailing }: Record<'title' | 'subtitle' | 'status' | 'trailing', ReactNode>) {
  return (
    <>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{title}</div>
        {subtitle ? <div className="truncate text-sm text-muted-foreground">{subtitle}</div> : null}
      </div>
      {status || trailing ? (
        <div className="flex shrink-0 flex-col items-end gap-1">
          {status}
          {trailing ? <div className="text-xs tabular-nums text-muted-foreground">{trailing}</div> : null}
        </div>
      ) : null}
    </>
  )
}

type DataTableListRowProps<TData extends object> = {
  row: DataTableBodyRowModel<TData>
  slots: DataTableMobileSlots
  rowBehaviour?: DataTableRowBehaviour<TData>
}

/** Tap target of a row: the existing `onRowClick`, else the detail link, else plain content. */
function ListRowPrimary<TData extends object>({
  record,
  rowBehaviour,
  children,
}: {
  record: TData
  rowBehaviour?: DataTableRowBehaviour<TData>
  children: ReactNode
}) {
  const rowHref = rowBehaviour?.getRowHref?.(record)
  const onRowClick = rowBehaviour?.onRowClick

  if (onRowClick) {
    return (
      <TappableRow onActivate={() => onRowClick(record)}>
        {children}
      </TappableRow>
    )
  }
  if (rowHref) {
    return (
      <Link to={rowHref} className={rowPrimaryClassName}>
        {children}
      </Link>
    )
  }
  return <div className={rowPrimaryClassName}>{children}</div>
}

function DataTableListRow<TData extends object>({ row, slots, rowBehaviour }: DataTableListRowProps<TData>) {
  const record = row.original
  const cells = row.getVisibleCells()
  const slot = (id: string | undefined): ReactNode => {
    const cell = cells.find((candidate) => candidate.column.id === id)
    return cell ? flexRender(cell.column.columnDef.cell as never, cell.getContext() as never) : null
  }

  // Display-column buttons (id "actions") have no registry action behind them, so they stay reachable next to the "..." menu.
  const actionsCell = slot('actions')

  return (
    <li data-table-row="true" data-row-id={getTableRowId(record)} className="flex items-center">
      <ListRowPrimary record={record} rowBehaviour={rowBehaviour}>
        <ListRowContent title={slot(slots.title)} subtitle={slot(slots.subtitle)} status={slot(slots.status)} trailing={slot(slots.trailing)} />
      </ListRowPrimary>
      {actionsCell ? <div className="shrink-0">{actionsCell}</div> : null}
      <DataTableRowActions row={record} rowBehaviour={rowBehaviour} />
    </li>
  )
}

/** Phone list mode of {@link DataTable}: two-line rows (title, subtitle, status, trailing) with a "..." row actions menu. */
export function DataTableList<TData extends object>({ columns, rows, rowBehaviour }: DataTableListProps<TData>) {
  const slots = getDataTableMobileSlots(columns)

  return (
    <ul className="divide-y rounded-md border" data-table-list="true">
      {rows.map((row) => (
        <DataTableListRow key={row.id} row={row} slots={slots} rowBehaviour={rowBehaviour} />
      ))}
    </ul>
  )
}
