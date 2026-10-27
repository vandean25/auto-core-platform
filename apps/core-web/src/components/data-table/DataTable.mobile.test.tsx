import { useState } from 'react'
import type { ColumnFiltersState, PaginationState, SortingState } from '@tanstack/react-table'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

function Harness({
  rowBehaviour,
  data = rows,
  isLoading = false,
  columns = baseColumns,
}: {
  rowBehaviour?: DataTableRowBehaviour<Row>
  data?: Row[]
  isLoading?: boolean
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

  it('shows a skeleton table while loading', () => {
    render(<Harness isLoading />)

    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true')
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
