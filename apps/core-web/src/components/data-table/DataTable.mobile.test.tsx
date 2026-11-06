import { useState } from 'react'
import type { ColumnFiltersState, PaginationState, SortingState } from '@tanstack/react-table'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataTable } from './DataTable'
import type { DataTableRowBehaviour } from './data-table-row-behaviour'
import { EntityActionConfirmHost } from '@/features/actions/action-confirm-host'
import { createCustomerRowActions } from '@/features/actions/customer-row-actions'
import { toDataTableContextActions } from '@/features/actions/entity-action'
import type { Customer } from '@/api/types'
import deCommon from '../../../../../locales/de/common.json'

type Row = { id: string; customer: string; vehicle: string; status: string; orderNo: string }

const rows: Row[] = [
  { id: 'a', customer: 'Pilot Customer 1', vehicle: '2018 Sprinter', status: 'OPEN', orderNo: 'WO-1' },
  { id: 'b', customer: 'Pilot Customer 2', vehicle: '2020 Octavia', status: 'DONE', orderNo: 'WO-2' },
]

const baseColumns: ColumnDef<Row>[] = [
  { accessorKey: 'orderNo', header: 'Nr.', meta: { mobile: 'trailing' } },
  { accessorKey: 'customer', header: 'Kunde', meta: { mobile: 'title' } },
  { accessorKey: 'vehicle', header: 'Fahrzeug', meta: { mobile: 'subtitle' } },
  { accessorKey: 'status', header: 'Status', meta: { mobile: 'status' } },
]

const actionsColumn: ColumnDef<Row> = { id: 'actions', cell: () => <button type="button">Quittieren</button> }

const detailsColumn: ColumnDef<Row> = {
  id: 'details',
  cell: () => <span>Lieferbar 3</span>,
  meta: { mobile: 'details' },
}

function Harness({
  rowBehaviour,
  data = rows,
  isLoading = false,
  hasUsableData,
  isFetching,
  isPlaceholderData,
  columns = baseColumns,
}: {
  rowBehaviour?: DataTableRowBehaviour<Row>
  data?: Row[]
  isLoading?: boolean
  hasUsableData?: boolean
  isFetching?: boolean
  isPlaceholderData?: boolean
  columns?: ColumnDef<Row>[]
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  return (
    <MemoryRouter>
      <DataTable<Row>
        columns={columns}
        data={data}
        isLoading={isLoading}
        hasUsableData={hasUsableData}
        isFetching={isFetching}
        isPlaceholderData={isPlaceholderData}
        columnFilters={columnFilters}
        setColumnFilters={setColumnFilters}
        sorting={sorting}
        setSorting={setSorting}
        pagination={pagination}
        setPagination={setPagination}
        rowBehaviour={rowBehaviour}
      />
    </MemoryRouter>
  )
}

const originalWidth = window.innerWidth
const setViewport = (width: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })

beforeEach(() => setViewport(375))
afterEach(() => {
  cleanup()
  setViewport(originalWidth)
})

describe('DataTable list mode', () => {
  it('renders two-line rows instead of a table below md', () => {
    render(<Harness />)

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    const first = screen.getAllByRole('listitem')[0]
    expect(within(first).getByText('Pilot Customer 1')).toBeInTheDocument()
    expect(within(first).getByText('2018 Sprinter')).toBeInTheDocument()
    expect(within(first).getByText('OPEN')).toBeInTheDocument()
    expect(within(first).getByText('WO-1')).toBeInTheDocument()
  })

  it('keeps the table from md upwards', () => {
    setViewport(1024)
    render(<Harness />)

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('opens the row behaviour on tap and exposes row actions through the "..." menu', () => {
    const onRowClick = vi.fn()
    const onDelete = vi.fn()
    render(
      <Harness
        rowBehaviour={{
          onRowClick,
          getRowContextActions: () => [
            { id: 'order.open', label: 'Öffnen', onClick: vi.fn() },
            { id: 'order.delete', label: 'Löschen', destructive: true, onClick: onDelete },
          ],
        }}
      />,
    )

    const first = screen.getAllByRole('listitem')[0]
    fireEvent.click(within(first).getByText('Pilot Customer 1'))
    expect(onRowClick).toHaveBeenCalledWith(rows[0])

    const trigger = within(first).getByRole('button', { name: deCommon.dataTable.rowActions })
    expect(onRowClick).toHaveBeenCalledTimes(1)
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    expect(screen.getByRole('menuitem', { name: 'Öffnen' })).toHaveAttribute('data-action-id', 'order.open')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Löschen' }))
    expect(onDelete).toHaveBeenCalledWith(rows[0])
  })

  it('shows no "..." button when the role has no row actions', () => {
    render(<Harness rowBehaviour={{ getRowContextActions: () => [] }} />)

    expect(screen.queryByRole('button', { name: deCommon.dataTable.rowActions })).not.toBeInTheDocument()
  })

  it('shows the empty state with the header row hidden', () => {
    render(<Harness data={[]} />)

    expect(screen.getByText(deCommon.dataTable.noResults)).toBeInTheDocument()
    expect(screen.getAllByRole('rowgroup')[0]).toHaveClass('hidden')
  })

  it('labels the "..." button with the row name when the list provides one', () => {
    render(
      <Harness
        rowBehaviour={{
          getRowAccessibleName: (row) => `Auftrag ${row.orderNo}`,
          getRowContextActions: () => [{ id: 'order.open', label: 'Öffnen', onClick: vi.fn() }],
        }}
      />,
    )

    expect(screen.getByRole('button', { name: 'Aktionen für Auftrag WO-1' })).toBeInTheDocument()
  })

  it('activates the row with Enter and Space on the row itself, not on nested controls', () => {
    const onRowClick = vi.fn()
    render(<Harness rowBehaviour={{ onRowClick }} columns={[...baseColumns, actionsColumn]} />)

    const tap = screen.getAllByRole('button', { name: /Pilot Customer 1/ })[0]
    fireEvent.keyDown(tap, { key: 'Enter' })
    fireEvent.keyDown(tap, { key: ' ' })
    expect(onRowClick).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getAllByRole('button', { name: 'Quittieren' })[0])
    expect(onRowClick).toHaveBeenCalledTimes(2)
  })

  it('falls back to the detail link when the list has no onRowClick', () => {
    render(<Harness rowBehaviour={{ getRowHref: (row) => `/orders/${row.id}` }} />)

    expect(screen.getAllByRole('link')[0]).toHaveAttribute('href', '/orders/a')
  })

  it('keeps display-column buttons (actions column) reachable in the row', () => {
    render(<Harness columns={[...baseColumns, actionsColumn]} />)

    const row = screen.getAllByRole('listitem')[0]
    // Wide cells wrap below the title instead of overflowing; their buttons get 44px targets.
    expect(row).toHaveClass('flex-wrap')
    expect(within(row).getByRole('button', { name: 'Quittieren' }).parentElement).toHaveClass('[&_button]:min-h-11')
  })

  it('renders a details column below the row, out of the tap target and its truncating slots', () => {
    const onRowClick = vi.fn()
    render(<Harness columns={[...baseColumns, detailsColumn]} rowBehaviour={{ onRowClick }} />)

    const row = screen.getAllByRole('listitem')[0]
    const tap = within(row).getByRole('button', { name: /Pilot Customer 1/ })
    expect(within(tap).queryByText('Lieferbar 3')).not.toBeInTheDocument()

    const details = within(row).getByText('Lieferbar 3')
    expect(details.parentElement).toHaveClass('w-full')
  })

  it('shows a skeleton table while loading', () => {
    vi.useFakeTimers()
    render(<Harness isLoading data={[]} hasUsableData={false} />)

    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'false')

    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true')
    vi.useRealTimers()
  })

  // Regression: a stale preview used to swap the phone card list for a headerless table and back when the data arrived.
  it('keeps the card list, locked and busy, while a stale preview refetches at 375px', () => {
    const onRowClick = vi.fn()
    const rowBehaviour = {
      onRowClick,
      getRowContextActions: () => [{ id: 'order.open', label: 'Öffnen', onClick: vi.fn() }],
    }
    const { rerender } = render(<Harness rowBehaviour={rowBehaviour} hasUsableData />)
    const list = screen.getByRole('list')

    rerender(<Harness rowBehaviour={rowBehaviour} hasUsableData isFetching isPlaceholderData />)

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('list')).toBe(list)
    expect(list).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toHaveTextContent(deCommon.dataTable.loading.stalePreview)
    fireEvent.click(within(screen.getAllByRole('listitem')[0]).getByText('Pilot Customer 1'))
    expect(onRowClick).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: deCommon.dataTable.rowActions })).not.toBeInTheDocument()

    rerender(<Harness rowBehaviour={rowBehaviour} hasUsableData isFetching={false} isPlaceholderData={false} />)

    expect(screen.getByRole('list')).toBe(list)
    expect(list).toHaveAttribute('aria-busy', 'false')
    fireEvent.click(within(screen.getAllByRole('listitem')[0]).getByText('Pilot Customer 1'))
    expect(onRowClick).toHaveBeenCalledWith(rows[0])
  })

  // Regression: every pending row was dimmed with opacity-60, so the Retry/Dismiss controls of a failed row looked disabled.
  it('keeps the controls of a pending row at full opacity and 44px on the phone list', () => {
    const pendingRow = { id: 'local-1', __dataTablePending: true as const, customer: 'Pilot Customer 3', vehicle: '2019 Golf', status: 'OPEN', orderNo: '' }
    const columns: ColumnDef<Row>[] = baseColumns.map((column) =>
      'accessorKey' in column && column.accessorKey === 'customer'
        ? { ...column, cell: ({ row }) => (<><span>{row.original.customer}</span><button type="button" className="min-h-11">Erneut versuchen</button></>) }
        : column,
    )
    render(<Harness data={[pendingRow, ...rows]} columns={columns} rowBehaviour={{ onRowClick: vi.fn() }} />)

    const item = screen.getAllByRole('listitem')[0]
    expect(item).not.toHaveClass('opacity-60')
    expect(item).toHaveClass('text-muted-foreground')
    expect(within(item).getByRole('button', { name: 'Erneut versuchen' })).toHaveClass('min-h-11')
    fireEvent.click(within(item).getByText('Pilot Customer 3'))
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('hides the CSV export on phone because it reads table cells', () => {
    render(<Harness />)

    expect(screen.getByRole('button', { name: deCommon.dataTable.exportCsv })).toHaveClass('max-md:hidden')
  })

  it('keeps the destructive confirm step for registry actions in the "..." menu', () => {
    const onDelete = vi.fn()
    const definitions = createCustomerRowActions(((key: string) => key) as never)
    render(
      <>
        <Harness
          rowBehaviour={{
            getRowContextActions: (row) =>
              toDataTableContextActions(definitions, 'ADMIN', { id: row.id } as Customer, {
                navigate: vi.fn(),
                onDelete,
                t: ((key: string) => key) as never,
              }) as never,
          }}
        />
        <EntityActionConfirmHost />
      </>,
    )

    fireEvent.pointerDown(screen.getAllByRole('button', { name: deCommon.dataTable.rowActions })[0], { button: 0, ctrlKey: false })
    fireEvent.click(document.querySelector('[data-action-id="customer.delete"]') as HTMLElement)

    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'list.delete', hidden: true }))
    expect(onDelete).toHaveBeenCalledWith('a')
  })
})
