import { useState } from 'react'
import type { ColumnFiltersState, PaginationState, SortingState } from '@tanstack/react-table'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataTable } from './DataTable'
import deCommon from '../../../../../locales/de/common.json'

type Row = { id: string; name: string; status: string; amount: number }

const dt = deCommon.dataTable
const rows: Row[] = [
  { id: 'a', name: 'Alpha', status: 'OPEN', amount: 10 },
  { id: 'b', name: 'Beta', status: 'DONE', amount: 20 },
]

const columns: ColumnDef<Row>[] = [
  { accessorKey: 'name', header: 'Name' },
  {
    accessorKey: 'status',
    header: 'Status',
    meta: {
      filter: {
        type: 'faceted',
        title: 'Status',
        options: [
          { value: 'OPEN', label: 'Offen', count: 4 },
          { value: 'DONE', label: 'Erledigt', count: 7 },
        ],
      },
    },
  },
  { accessorKey: 'amount', header: 'Betrag', meta: { numeric: true } },
  { accessorKey: 'created', header: 'Datum', meta: { filter: { type: 'dateRange', title: 'Zeitraum' } } },
]

function Harness({
  data = rows,
  initialFilters = [],
  onFiltersChange,
  ...props
}: Partial<React.ComponentProps<typeof DataTable<Row>>> & {
  initialFilters?: ColumnFiltersState
  onFiltersChange?: (filters: ColumnFiltersState) => void
}) {
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(initialFilters)
  const [sorting, setSorting] = useState<SortingState>([])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })
  return (
    <MemoryRouter>
      <DataTable<Row>
        columns={columns}
        data={data}
        columnFilters={columnFilters}
        setColumnFilters={(updater) => {
          setColumnFilters((previous) => {
            const next = typeof updater === 'function' ? updater(previous) : updater
            onFiltersChange?.(next)
            return next
          })
        }}
        sorting={sorting}
        setSorting={setSorting}
        pagination={pagination}
        setPagination={setPagination}
        {...props}
      />
    </MemoryRouter>
  )
}

afterEach(cleanup)

describe('DataTable filters', () => {
  it('multi-selects facet options with counts and stores a comma-joined string', () => {
    const onFiltersChange = vi.fn()
    render(<Harness onFiltersChange={onFiltersChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Status' }))
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('option', { name: /Offen/ }))
    fireEvent.click(screen.getByRole('option', { name: /Erledigt/ }))

    expect(onFiltersChange).toHaveBeenLastCalledWith([{ id: 'status', value: 'OPEN,DONE' }])
    expect(screen.getByRole('option', { name: /Offen/ })).toHaveTextContent(dt.filters.itemSelected)
    expect(screen.getByRole('button', { name: /Status/ })).toHaveTextContent('2 ausgewählt')
  })

  it('clears a facet filter', () => {
    const onFiltersChange = vi.fn()
    render(<Harness initialFilters={[{ id: 'status', value: 'OPEN' }]} onFiltersChange={onFiltersChange} />)

    fireEvent.click(screen.getByRole('button', { name: /Status/ }))
    fireEvent.click(screen.getByRole('option', { name: dt.filters.clear }))

    expect(onFiltersChange).toHaveBeenLastCalledWith([])
  })

  it('shows a date range restored from the URL in de-AT format and clears it', () => {
    const onFiltersChange = vi.fn()
    render(<Harness initialFilters={[{ id: 'created', value: '2026-01-05,2026-01-20' }]} onFiltersChange={onFiltersChange} />)

    const trigger = screen.getByRole('button', { name: /Zeitraum/ })
    expect(trigger).toHaveTextContent('05.01.2026 – 20.01.2026')

    fireEvent.click(trigger)
    // de-AT locale: January is "Jänner".
    expect(screen.getByText(/Jänner 2026/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: dt.filters.clear }))

    expect(onFiltersChange).toHaveBeenLastCalledWith([])
  })

  it('picks a date range by clicking two days', () => {
    const onFiltersChange = vi.fn()
    render(<Harness initialFilters={[{ id: 'created', value: '2026-01-05,' }]} onFiltersChange={onFiltersChange} />)

    fireEvent.click(screen.getByRole('button', { name: /Zeitraum/ }))
    const grid = screen.getByRole('grid')
    fireEvent.click(within(grid).getByRole('button', { name: /20\. Jänner 2026/ }))

    expect(onFiltersChange).toHaveBeenLastCalledWith([{ id: 'created', value: '2026-01-05,2026-01-20' }])
  })
})

describe('DataTable states', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows nothing, then skeleton rows after the delay, and never the empty state while loading', () => {
    const { container } = render(<Harness data={[]} isLoading />)

    expect(container.querySelectorAll('tbody tr')).toHaveLength(0)
    expect(screen.queryByText(dt.noResults)).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(container.querySelectorAll('tbody tr').length).toBeGreaterThan(0)
    expect(container.querySelector('tbody .animate-pulse')).not.toBeNull()
    expect(screen.queryByText(dt.noResults)).not.toBeInTheDocument()
    expect(container.querySelector('table')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toHaveTextContent(deCommon.shell.loading)
  })

  it('does not flash a skeleton when loading finishes within the delay', () => {
    const { container, rerender } = render(<Harness data={[]} isLoading />)
    act(() => {
      vi.advanceTimersByTime(100)
    })
    rerender(<Harness data={rows} isLoading={false} />)
    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(container.querySelector('tbody .animate-pulse')).toBeNull()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })

  it('renders the Empty state with message and action', () => {
    render(<Harness data={[]} emptyState={{ message: 'Noch keine Einträge', action: <button type="button">Eintrag</button> }} />)

    expect(screen.getByText('Noch keine Einträge')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Eintrag' })).toBeInTheDocument()
  })

  it('drops the empty-state action and says "no results" while a filter is active', () => {
    render(
      <Harness
        data={[]}
        initialFilters={[{ id: 'status', value: 'OPEN' }]}
        emptyState={{ message: 'Noch keine Einträge', action: <button type="button">Eintrag</button> }}
      />,
    )

    expect(screen.getByText(dt.noResults)).toBeInTheDocument()
    expect(screen.queryByText('Noch keine Einträge')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Eintrag' })).not.toBeInTheDocument()
  })

  it('falls back to the default empty message without an action', () => {
    render(<Harness data={[]} />)

    expect(screen.getByText(dt.noResults)).toBeInTheDocument()
  })
})

describe('DataTable layout options', () => {
  it('marks numeric columns right-aligned with tabular figures and keeps the header sticky', () => {
    const { container } = render(<Harness />)

    expect(screen.getByRole('cell', { name: '10' })).toHaveClass('text-right', 'tabular-nums')
    expect(screen.getByRole('columnheader', { name: 'Betrag' })).toHaveClass('text-right')
    expect(container.querySelector('thead')).toHaveClass('sticky', 'top-0')
  })

  it('toggles compact density', () => {
    const { container } = render(<Harness />)

    expect(container.querySelector('[data-density]')).toHaveAttribute('data-density', 'normal')
    fireEvent.keyDown(screen.getByRole('button', { name: dt.columns }), { key: 'Enter' })
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: dt.density.compact }))

    expect(container.querySelector('[data-density]')).toHaveAttribute('data-density', 'compact')
  })
})

describe('DataTable action bar', () => {
  const bulkActions = (selected: Row[]) => <button type="button">Löschen ({selected.map((row) => row.name).join(', ')})</button>

  it('adds no checkbox column or bar without bulkActions', () => {
    render(<Harness />)

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  })

  it('docks bulk actions in a floating bar while rows are selected, and clears the selection', () => {
    render(<Harness bulkActions={bulkActions} />)

    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('checkbox', { name: dt.selectRow })[0])

    const bar = screen.getByRole('toolbar', { name: dt.actionBar.label })
    expect(within(bar).getByText('1 ausgewählt')).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: 'Löschen (Alpha)' })).toBeInTheDocument()

    fireEvent.click(within(bar).getByRole('button', { name: dt.actionBar.clear }))
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  })

  it('select-all selects every row on the page', () => {
    render(<Harness bulkActions={bulkActions} />)

    fireEvent.click(screen.getByRole('checkbox', { name: dt.selectAll }))

    expect(within(screen.getByRole('toolbar')).getByText('2 ausgewählt')).toBeInTheDocument()
  })

  it('drops the selection when the filter changes', () => {
    render(<Harness bulkActions={bulkActions} />)
    fireEvent.click(screen.getAllByRole('checkbox', { name: dt.selectRow })[0])
    expect(screen.getByRole('toolbar')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Status' }))
    fireEvent.click(screen.getByRole('option', { name: /Offen/ }))

    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  })

  it('does not open the row when the padding around a checkbox is clicked', () => {
    const onRowClick = vi.fn()
    render(<Harness bulkActions={bulkActions} onRowClick={onRowClick} />)

    fireEvent.click(screen.getAllByRole('checkbox', { name: dt.selectRow })[0].closest('td')!)

    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('does not trigger onRowClick when a row checkbox is clicked', () => {
    const onRowClick = vi.fn()
    render(<Harness bulkActions={bulkActions} onRowClick={onRowClick} />)

    fireEvent.click(screen.getAllByRole('checkbox', { name: dt.selectRow })[0])

    expect(onRowClick).not.toHaveBeenCalled()
  })
})
