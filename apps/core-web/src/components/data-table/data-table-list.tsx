import { flexRender } from '@tanstack/react-table'
import { MoreHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { useLayoutEffect, useRef, useState, type HTMLAttributes, type Ref, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { getTableRowId, type DataTableBodyRowModel } from './data-table-body-row'
import { isDataTablePendingRow } from './data-table-states'
import { getDataTableMobileSlots, type DataTableMobileSlots } from './data-table-column-meta'
import type { DataTableRowBehaviour } from './data-table-row-behaviour'
import type { DataTableInfiniteView } from './use-data-table-infinite'
import { useDataTableVirtualEffects, useDataTableVirtualOptions } from './use-data-table-virtual'

// Two-line card (min-h-14) until a card has been measured; cards with a details line are taller.
const ESTIMATED_CARD_HEIGHT = 72

type DataTableListProps<TData extends object> = {
  columns: Parameters<typeof getDataTableMobileSlots>[0]
  rows: DataTableBodyRowModel<TData>[]
  rowBehaviour?: DataTableRowBehaviour<TData>
  interactionLocked?: boolean
  /** Present in infinite mode: only the cards near the viewport (and the focused one) are rendered, each measured. */
  infiniteView?: DataTableInfiniteView
}

const rowPrimaryClassName = 'flex min-h-14 min-w-40 flex-1 items-center gap-3 py-2 pl-3 text-left last:pr-3'

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
        <div className="break-words font-medium">{title}</div>
        {subtitle ? <div className="truncate text-sm text-muted-foreground">{subtitle}</div> : null}
      </div>
      {status || trailing ? (
        <div className="flex shrink-0 flex-col items-end gap-1">
          {status}
          {trailing ? <div className="text-sm tabular-nums text-muted-foreground">{trailing}</div> : null}
        </div>
      ) : null}
    </>
  )
}

type DataTableListRowProps<TData extends object> = {
  row: DataTableBodyRowModel<TData>
  slots: DataTableMobileSlots
  rowBehaviour?: DataTableRowBehaviour<TData>
  interactionLocked?: boolean
  /** Position, measuring and focus tracking of a virtualized card. */
  itemProps?: HTMLAttributes<HTMLLIElement> & { ref?: Ref<HTMLLIElement>; 'data-index'?: number }
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

function listRowClassName(interactionLocked: boolean, isPending: boolean, extra: string | undefined) {
  return cn(
    'flex flex-wrap items-center',
    interactionLocked && 'opacity-60',
    isPending && 'bg-muted/40 text-muted-foreground',
    extra,
  )
}

function DataTableListRow<TData extends object>({
  row,
  slots,
  rowBehaviour,
  interactionLocked = false,
  itemProps,
}: DataTableListRowProps<TData>) {
  const record = row.original
  const isPending = isDataTablePendingRow(record)
  const cells = row.getVisibleCells()
  const slot = (id: string | undefined): ReactNode => {
    const cell = cells.find((candidate) => candidate.column.id === id)
    return cell ? flexRender(cell.column.columnDef.cell as never, cell.getContext() as never) : null
  }

  // Display-column buttons (id "actions") have no registry action behind them, so they stay reachable next to the "..." menu.
  const actionsCell = slot('actions')
  const detailsCell = slot(slots.details)

  return (
    <li
      {...itemProps}
      data-table-row="true"
      data-row-id={getTableRowId(record)}
      className={listRowClassName(interactionLocked, isPending, itemProps?.className)}
    >
      <ListRowPrimary
        record={record}
        rowBehaviour={interactionLocked || isPending ? undefined : rowBehaviour}
      >
        <ListRowContent title={slot(slots.title)} subtitle={slot(slots.subtitle)} status={slot(slots.status)} trailing={slot(slots.trailing)} />
      </ListRowPrimary>
      {actionsCell ? (
        <div className="ml-auto max-w-full shrink-0 px-3 [&_button]:min-h-11 [&_button]:min-w-11">{actionsCell}</div>
      ) : null}
      {/* Wide content (controls, notes) needs its own line: inside the slots it would be truncated or squeeze the row. */}
      {detailsCell ? <div className="w-full px-3 pb-2">{detailsCell}</div> : null}
      {!interactionLocked && !isPending ? (
        <DataTableRowActions row={record} rowBehaviour={rowBehaviour} />
      ) : null}
    </li>
  )
}

/** Phone list mode of {@link DataTable}: two-line rows (title, subtitle, status, trailing), an optional full-width details line and a "..." row actions menu. */
export function DataTableList<TData extends object>({
  columns,
  rows,
  rowBehaviour,
  interactionLocked = false,
  infiniteView,
}: DataTableListProps<TData>) {
  const slots = getDataTableMobileSlots(columns)
  const listRef = useRef<HTMLUListElement | null>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  const [focusedKey, setFocusedKey] = useState<string | null>(null)
  const rowKeys = rows.map((row) => row.id)

  // The page scrolls, not the list: its distance from the page top moves with banners and filters above it.
  useLayoutEffect(() => {
    const top = listRef.current ? listRef.current.getBoundingClientRect().top + window.scrollY : 0
    setScrollMargin((previous) => (previous === top ? previous : top))
  }, [rows.length, interactionLocked, infiniteView?.needsRefresh, infiniteView?.epoch])

  const virtualizer = useWindowVirtualizer<Element>({
    ...useDataTableVirtualOptions<Window>(infiniteView, rowKeys, focusedKey === null ? -1 : rowKeys.indexOf(focusedKey)),
    estimateSize: () => ESTIMATED_CARD_HEIGHT,
    scrollMargin,
  })
  useDataTableVirtualEffects(virtualizer, infiniteView, rowKeys, scrollMargin)

  if (!infiniteView) {
    return (
      <ul className="divide-y rounded-md border" data-table-list="true" aria-busy={interactionLocked}>
        {rows.map((row) => (
          <DataTableListRow key={row.id} row={row} slots={slots} rowBehaviour={rowBehaviour} interactionLocked={interactionLocked} />
        ))}
      </ul>
    )
  }

  const setSize = infiniteView.ariaRowCount < 0 ? -1 : infiniteView.ariaRowCount - 1
  return (
    <ul
      ref={listRef}
      className="relative overflow-hidden rounded-md border"
      style={{ height: virtualizer.getTotalSize() }}
      data-table-list="true"
      aria-busy={interactionLocked}
    >
      {virtualizer.getVirtualItems().map((item) => {
        const row = rows[item.index]
        if (!row) return null
        return (
          <DataTableListRow
            key={row.id}
            row={row}
            slots={slots}
            rowBehaviour={rowBehaviour}
            interactionLocked={interactionLocked}
            itemProps={{
              ref: virtualizer.measureElement,
              'data-index': item.index,
              'aria-posinset': item.index + 1,
              'aria-setsize': setSize,
              className: cn('absolute left-0 top-0 w-full', item.index > 0 && 'border-t'),
              style: { transform: `translateY(${item.start - scrollMargin}px)` },
              onFocus: () => setFocusedKey(row.id),
              onBlur: (event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setFocusedKey(null)
              },
            }}
          />
        )
      })}
    </ul>
  )
}
