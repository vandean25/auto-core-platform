import { useState } from 'react'
import type { ColumnFiltersState, PaginationState, SortingState } from '@tanstack/react-table'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { densityTokens } from '@/lib/density-tokens'
import { createEchoSafeInvalidator } from '@/features/realtime/echo-safe-invalidator'
import { bindSingleKeyShortcutsUser } from '@/features/shortcuts/single-key-shortcuts-setting'
import { clearListScrollAnchors } from '@/lib/list-scroll-anchors'
import { DataTable } from './DataTable'
import {
  HEADER_HEIGHT,
  InfiniteListHarness,
  PAGE_SIZE,
  ROW_HEIGHT,
  createListClient,
  dt as infiniteDt,
  listKey,
  mockListLayout,
  pageOf,
  renderedRowIds,
  scrollRegion,
  scrollTo,
  seedLoadedPages,
  type PageRequest,
} from './data-table-infinite-test-utils'
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
    act(() => {
      vi.advanceTimersByTime(0)
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

  it('WHEN a skeleton has appeared THEN it stays at least 350 ms unless bypassed', () => {
    const { container, rerender } = render(<Harness data={[]} isLoading />)
    act(() => vi.advanceTimersByTime(200))
    act(() => vi.advanceTimersByTime(0))
    expect(container.querySelector('tbody .animate-pulse')).not.toBeNull()

    rerender(<Harness data={rows} isLoading={false} hasUsableData />)
    act(() => vi.advanceTimersByTime(349))
    expect(container.querySelector('tbody .animate-pulse')).not.toBeNull()

    act(() => vi.advanceTimersByTime(1))
    expect(container.querySelector('tbody .animate-pulse')).toBeNull()
    expect(screen.getByText('Alpha')).toBeInTheDocument()

    rerender(<Harness data={[]} isLoading bypassSkeleton />)
    act(() => vi.advanceTimersByTime(200))
    expect(container.querySelector('tbody .animate-pulse')).toBeNull()
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

  // Scenario 5 (AUT-881): WHEN the density toggle is set to compact THEN row height uses the compact token.
  it('toggles compact density', () => {
    const { container } = render(<Harness />)
    const grid = container.querySelector('[data-density]')

    // Comfortable is the base Table metric, so the default mode applies no density rule at all.
    expect(grid).toHaveAttribute('data-density', 'comfortable')
    expect(grid?.className).not.toContain(densityTokens.compactRowClass)
    expect(grid?.className).not.toContain(densityTokens.compactHeaderClass)

    fireEvent.keyDown(screen.getByRole('button', { name: dt.columns }), { key: 'Enter' })
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: dt.density.compact }))

    const compactGrid = container.querySelector('[data-density]')
    expect(compactGrid).toHaveAttribute('data-density', 'compact')
    expect(compactGrid?.className).toContain(densityTokens.compactRowClass)
    expect(compactGrid?.className).toContain(densityTokens.compactHeaderClass)
  })

  // Regression: naming the density tokens must not re-pad the empty-state cell in the default mode.
  it('keeps the empty-state cell padding-free in the default density', () => {
    const { container } = render(<Harness data={[]} />)
    const grid = container.querySelector('[data-density]')
    const cell = screen.getByText(dt.noResults).closest('td')

    expect(grid).toHaveAttribute('data-density', 'comfortable')
    expect(grid?.className).not.toContain(densityTokens.compactRowClass)
    expect(cell).toHaveClass('p-0')
    expect(cell?.className).not.toMatch(/\bp-3\b/)
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
    render(<Harness bulkActions={bulkActions} rowBehaviour={{ onRowClick }} />)

    fireEvent.click(screen.getAllByRole('checkbox', { name: dt.selectRow })[0].closest('td')!)

    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('does not trigger onRowClick when a row checkbox is clicked', () => {
    const onRowClick = vi.fn()
    render(<Harness bulkActions={bulkActions} rowBehaviour={{ onRowClick }} />)

    fireEvent.click(screen.getAllByRole('checkbox', { name: dt.selectRow })[0])

    expect(onRowClick).not.toHaveBeenCalled()
  })
})

describe('DataTable infinite mode (AUT-889)', () => {
  let restoreLayout: () => void
  const neverResolves = () => vi.fn((_request: PageRequest) => new Promise<ReturnType<typeof pageOf>>(() => undefined))
  const respondWithPages = (pages = Infinity) =>
    vi.fn(({ page }: PageRequest) => Promise.resolve(pageOf(page, { pages })))
  const bottomOf = (pages: number) => HEADER_HEIGHT + pages * PAGE_SIZE * ROW_HEIGHT - 700

  beforeEach(() => {
    restoreLayout = mockListLayout()
    clearListScrollAnchors()
    bindSingleKeyShortcutsUser('infinite-test')
  })
  afterEach(() => restoreLayout())

  // Pilot check "Requests", scenario 1: a scroll handler that fetched on every event cancelled the running fetch each time.
  it('WHEN the user scrolls to one viewport before the end and hasNextPage is true THEN exactly one next-page fetch starts', async () => {
    const client = createListClient()
    seedLoadedPages(client, 1)
    const fetchPage = neverResolves()
    render(<InfiniteListHarness client={client} fetchPage={fetchPage} />)

    expect(renderedRowIds().length).toBeLessThan(40)
    scrollTo(3000)
    expect(fetchPage).not.toHaveBeenCalled()

    scrollTo(4100)
    scrollTo(4200)
    scrollTo(4300)
    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(1))
    expect(fetchPage).toHaveBeenCalledWith({ page: 1, filter: '' })
  })

  // Pilot check "Requests": a short first page leaves a viewport without a scrollbar, so no scroll event would ever load more.
  it('WHEN the first page does not fill the viewport THEN the next page loads without any scrolling', async () => {
    const client = createListClient()
    const fetchPage = respondWithPages(3)
    client.setQueryData(listKey(''), { pages: [pageOf(0, { pages: 3, size: 5 })], pageParams: [0] })
    render(<InfiniteListHarness client={client} fetchPage={fetchPage} />)

    await waitFor(() => expect(fetchPage).toHaveBeenCalledWith({ page: 1, filter: '' }))
  })

  // Pilot check "Requests", scenario 2: 1,900 rows still load, 2,000 stop; the stop is not the end of the list.
  it.each([
    { pages: 19, loadsMore: true },
    { pages: 20, loadsMore: false },
  ])('WHEN $pages pages are loaded THEN loading more is $loadsMore', async ({ pages, loadsMore }) => {
    const client = createListClient()
    seedLoadedPages(client, pages)
    const fetchPage = neverResolves()
    render(<InfiniteListHarness client={client} fetchPage={fetchPage} />)

    scrollTo(bottomOf(pages))
    if (loadsMore) {
      await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(1))
      return
    }
    expect(await screen.findByText(/Filter verfeinern/)).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('button', { name: infiniteDt.infinite.loadMore })).not.toBeInTheDocument()
    expect(fetchPage).not.toHaveBeenCalled()
  })

  // Pilot check "Requests", scenario 3: a realtime event refetched every retained page (20 requests at 2,000 rows).
  it('WHEN a realtime event arrives with 2,000 rows loaded THEN no page is refetched and "Liste aktualisieren" appears', async () => {
    const client = createListClient()
    seedLoadedPages(client, 20)
    const fetchPage = respondWithPages()
    render(<InfiniteListHarness client={client} fetchPage={fetchPage} />)

    // The invalidation every realtime entity event takes.
    act(() => createEchoSafeInvalidator(client).invalidate(['infinite-rows']))
    const refresh = await screen.findByRole('button', { name: infiniteDt.refreshList })
    expect(fetchPage).not.toHaveBeenCalled()

    fireEvent.click(refresh)
    await waitFor(() => expect(client.getQueryData<{ pages: unknown[] }>(listKey(''))?.pages).toHaveLength(1))
    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(fetchPage).toHaveBeenCalledWith({ page: 0, filter: '' })
    expect(screen.queryByRole('button', { name: infiniteDt.refreshList })).not.toBeInTheDocument()
  })

  // Pilot check "Requests": the page landing cleared the stale flag, so an event before or during a load was silently dropped
  // (an already stale list ignores a second invalidation, and the success of the page resets the flag).
  it.each([
    { name: 'before the next page loads', eventDuringLoad: false },
    { name: 'while the next page loads', eventDuringLoad: true },
  ])('WHEN a realtime event arrives $name THEN the notice is still there after that page landed', async ({ eventDuringLoad }) => {
    const client = createListClient()
    seedLoadedPages(client, 1)
    let landPage: () => void = () => undefined
    const fetchPage = vi.fn(
      (_request: PageRequest) =>
        new Promise<ReturnType<typeof pageOf>>((resolve) => {
          landPage = () => resolve(pageOf(1))
        }),
    )
    render(<InfiniteListHarness client={client} fetchPage={fetchPage} />)
    const invalidator = createEchoSafeInvalidator(client)

    if (!eventDuringLoad) act(() => invalidator.invalidate(['infinite-rows']))
    scrollTo(4100)
    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(1))
    if (eventDuringLoad) act(() => invalidator.invalidate(['infinite-rows']))
    await act(async () => landPage())

    expect(await screen.findByRole('button', { name: infiniteDt.refreshList })).toBeInTheDocument()
    expect(client.getQueryData<{ pages: unknown[] }>(listKey(''))?.pages).toHaveLength(2)
  })

  // Review of 3a81697: the listener must not outlive the fetch it watches; a refresh right after a cancelled load is fresh.
  it('WHEN a refresh follows a next-page load THEN the notice does not come back', async () => {
    const client = createListClient()
    seedLoadedPages(client, 1)
    let landPage: () => void = () => undefined
    const fetchPage = vi.fn(({ page }: PageRequest) =>
      page === 1
        ? new Promise<ReturnType<typeof pageOf>>((resolve) => {
            landPage = () => resolve(pageOf(1))
          })
        : Promise.resolve(pageOf(0, { pages: 3 })),
    )
    render(<InfiniteListHarness client={client} fetchPage={fetchPage} />)

    scrollTo(4100)
    await waitFor(() => expect(fetchPage).toHaveBeenCalledWith({ page: 1, filter: '' }))
    act(() => createEchoSafeInvalidator(client).invalidate(['infinite-rows']))
    fireEvent.click(await screen.findByRole('button', { name: infiniteDt.refreshList }))
    await waitFor(() => expect(client.getQueryData<{ pages: unknown[] }>(listKey(''))?.pages).toHaveLength(1))
    await act(async () => landPage())

    await waitFor(() => expect(screen.queryByRole('button', { name: infiniteDt.refreshList })).not.toBeInTheDocument())
  })

  // Pilot check "Requests": remount, focus and reconnect no longer reload the retained pages; an old cache offers the refresh.
  it('WHEN a list that is cached for more than five minutes is shown again THEN it offers the refresh and loads nothing', async () => {
    const client = createListClient()
    seedLoadedPages(client, 2)
    client.setQueryData(listKey(''), client.getQueryData(listKey('')), { updatedAt: Date.now() - 6 * 60_000 })
    const fetchPage = respondWithPages()
    render(<InfiniteListHarness client={client} fetchPage={fetchPage} />)

    expect(await screen.findByRole('button', { name: infiniteDt.refreshList })).toBeInTheDocument()
    expect(fetchPage).not.toHaveBeenCalled()
  })

  // Pilot check "Requests"/"Zähler/Aktionen", scenario 4: a cached filter used to show its old chain and keep the selection.
  it('WHEN the filter changes THEN the selection is cleared and the list restarts at page one at the top, also for a cached filter', async () => {
    const client = createListClient()
    seedLoadedPages(client, 2)
    const onRowClick = vi.fn()
    let landFilterB: () => void = () => undefined
    const fetchPage = vi.fn(({ page, filter }: PageRequest) =>
      filter === 'B'
        ? new Promise<ReturnType<typeof pageOf>>((resolve) => {
            landFilterB = () => resolve(pageOf(page, { pages: 3 }))
          })
        : Promise.resolve(pageOf(page, { pages: 3 })),
    )
    render(<InfiniteListHarness client={client} fetchPage={fetchPage} withSelection rowBehaviour={{ onRowClick }} />)

    scrollTo(3000)
    fireEvent.click(within(document.querySelector('tr[data-row-key="r62"]') as HTMLElement).getByRole('checkbox'))
    expect(screen.getByText('1 gewählt')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Filter B' }))
    await waitFor(() => expect(fetchPage).toHaveBeenCalledWith({ page: 0, filter: 'B' }))
    expect(screen.queryByText(/gewählt/)).not.toBeInTheDocument()
    expect(scrollRegion().scrollTop).toBe(0)
    // Until filter B answers, the old rows are a preview nobody can act on.
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(document.querySelector('tr[data-row-key="r0"]') as HTMLElement)
    expect(onRowClick).not.toHaveBeenCalled()
    await act(async () => landFilterB())
    await waitFor(() => expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'false'))

    scrollTo(2000)
    fetchPage.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Filter A' }))
    await waitFor(() => expect(fetchPage).toHaveBeenCalledWith({ page: 0, filter: '' }))
    expect(fetchPage).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(client.getQueryData<{ pages: unknown[] }>(listKey(''))?.pages).toHaveLength(1))
    expect(scrollRegion().scrollTop).toBe(0)
  })

  // ADR-0035 §7/§8: "Liste aktualisieren" starts a new chain, so rows picked from the old one are no longer on screen.
  it('WHEN the user refreshes the list THEN the selection is cleared and the list is back at the top', async () => {
    const client = createListClient()
    seedLoadedPages(client, 2)
    render(<InfiniteListHarness client={client} fetchPage={respondWithPages(3)} withSelection />)

    scrollTo(3000)
    fireEvent.click(within(document.querySelector('tr[data-row-key="r62"]') as HTMLElement).getByRole('checkbox'))
    expect(screen.getByText('1 gewählt')).toBeInTheDocument()

    act(() => createEchoSafeInvalidator(client).invalidate(['infinite-rows']))
    fireEvent.click(await screen.findByRole('button', { name: infiniteDt.refreshList }))

    await waitFor(() => expect(client.getQueryData<{ pages: unknown[] }>(listKey(''))?.pages).toHaveLength(1))
    await waitFor(() => expect(screen.queryByRole('button', { name: infiniteDt.refreshList })).not.toBeInTheDocument())
    expect(scrollRegion().scrollTop).toBe(0)
    // r62 is on the new page one as well, so only the reset can have cleared it.
    expect(screen.queryByText(/gewählt/)).not.toBeInTheDocument()
    scrollTo(3000)
    expect(within(document.querySelector('tr[data-row-key="r62"]') as HTMLElement).getByRole('checkbox')).not.toBeChecked()
  })

  // ACP review note: a short cached chain is within one viewport of its end, so the load-ahead asked for the next page of the
  // old chain while page one was being fetched, and that page landed on top of the refreshed list.
  it('WHEN a restart reaches a short cached list THEN no next page of the old chain is requested while page one loads', async () => {
    const client = createListClient()
    seedLoadedPages(client, 1)
    client.setQueryData(listKey('B'), {
      pages: [pageOf(0, { size: 5 }), pageOf(1, { size: 5 })],
      pageParams: [0, 1],
    })
    let landPageOne: () => void = () => undefined
    const fetchPage = vi.fn(({ page }: PageRequest) =>
      page === 0
        ? new Promise<ReturnType<typeof pageOf>>((resolve) => {
            landPageOne = () => resolve(pageOf(0, { pages: 3 }))
          })
        : Promise.resolve(pageOf(page, { pages: 3 })),
    )
    render(<InfiniteListHarness client={client} fetchPage={fetchPage} />)

    fireEvent.click(screen.getByRole('button', { name: 'Filter B' }))
    await waitFor(() => expect(fetchPage).toHaveBeenCalledWith({ page: 0, filter: 'B' }))
    await act(async () => undefined)
    expect(fetchPage).toHaveBeenCalledTimes(1)

    await act(async () => landPageOne())
    await waitFor(() => expect(client.getQueryData<{ pages: unknown[] }>(listKey('B'))?.pages).toHaveLength(1))
    await act(async () => undefined)
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  // Pilot check "Bedienung", scenario 5: keyboard focus was a DOM position, which a virtualized window destroys.
  it('WHEN a focused row scrolls out of the render window via j/k THEN focus stays on the same record ID', async () => {
    const client = createListClient()
    seedLoadedPages(client, 1)
    render(<InfiniteListHarness client={client} fetchPage={respondWithPages()} rowBehaviour={{ onRowClick: vi.fn() }} />)

    ;(document.querySelector('tr[data-row-key="r0"]') as HTMLElement).focus()
    const press = (key: string) => act(async () => void fireEvent.keyDown(document, { key }))
    for (let count = 0; count < 40; count += 1) await press('j')
    expect(document.activeElement).toHaveAttribute('data-row-key', 'r40')
    expect(renderedRowIds()).not.toContain('r0')

    await press('k')
    expect(document.activeElement).toHaveAttribute('data-row-key', 'r39')

    // The focused row is never unmounted, however far the list is scrolled away from it.
    scrollTo(ROW_HEIGHT * 90)
    expect(renderedRowIds()).toContain('r39')
    expect(document.activeElement).toHaveAttribute('data-row-key', 'r39')
  })

  // Pilot check "Bedienung", scenario 6: a remounted list started at the top and the user lost their place.
  it('WHEN the user returns from a detail with the list cache present THEN the scroll position is restored by record and offset', async () => {
    const client = createListClient()
    seedLoadedPages(client, 1)
    const fetchPage = respondWithPages()
    const list = render(<InfiniteListHarness client={client} fetchPage={fetchPage} />)
    scrollTo(1500)
    list.unmount()

    render(<InfiniteListHarness client={client} fetchPage={fetchPage} />)
    await waitFor(() => expect(scrollRegion().scrollTop).toBe(1500))
    expect(renderedRowIds()).toContain('r29')
    expect(fetchPage).not.toHaveBeenCalled()
  })

  // Pilot check "Bedienung": without the cache the saved position would point into a different first page.
  it('WHEN the cache is gone after a detail view THEN the list starts at the top', async () => {
    const withCache = createListClient()
    seedLoadedPages(withCache, 1)
    const first = render(<InfiniteListHarness client={withCache} fetchPage={respondWithPages()} />)
    scrollTo(1500)
    first.unmount()

    render(<InfiniteListHarness client={createListClient()} fetchPage={respondWithPages()} />)
    await waitFor(() => expect(renderedRowIds()).toContain('r0'))
    expect(scrollRegion().scrollTop).toBe(0)
  })

  // Pilot check "Zähler/Aktionen": virtualization must not drop a selection or select pages that are not loaded.
  it('WHEN a selected row is virtualized away and back THEN it stays selected and "select all" names the loaded rows', () => {
    const client = createListClient()
    seedLoadedPages(client, 1)
    render(<InfiniteListHarness client={client} fetchPage={respondWithPages()} withSelection />)

    fireEvent.click(within(document.querySelector('tr[data-row-key="r2"]') as HTMLElement).getByRole('checkbox'))
    scrollTo(4000)
    expect(renderedRowIds()).not.toContain('r2')
    expect(screen.getByText('1 gewählt')).toBeInTheDocument()

    scrollTo(0)
    expect(within(document.querySelector('tr[data-row-key="r2"]') as HTMLElement).getByRole('checkbox')).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Alle 100 geladenen Zeilen auswählen' })).toBeInTheDocument()
  })

  // Pilot check "Zähler/Aktionen": pages overlap when rows are inserted between two requests (live list, no snapshot).
  it('WHEN two pages contain the same record THEN it is listed once', () => {
    const client = createListClient()
    const overlapping = { ...pageOf(1), data: pageOf(0).data.slice(-1).concat(pageOf(1).data.slice(0, 50)) }
    client.setQueryData(listKey(''), { pages: [pageOf(0), overlapping], pageParams: [0, 1] })
    render(<InfiniteListHarness client={client} fetchPage={respondWithPages()} withSelection />)

    expect(screen.getByRole('checkbox', { name: 'Alle 150 geladenen Zeilen auswählen' })).toBeInTheDocument()
  })

  // Pilot check "Bedienung": announced positions follow the header row; a capped or unknown total is -1, never 1000.
  it.each([
    { name: 'more pages and no count', totalCount: undefined, pages: Infinity, expected: '-1' },
    { name: 'a capped count', totalCount: { count: 1000, isCapped: true }, pages: Infinity, expected: '-1' },
    { name: 'a known count', totalCount: { count: 250, isCapped: false }, pages: Infinity, expected: '251' },
    { name: 'the end of the list', totalCount: undefined, pages: 1, expected: '101' },
  ])('exposes aria-rowcount $expected for $name and aria-rowindex from 1 (header)', ({ totalCount, pages, expected }) => {
    const client = createListClient()
    seedLoadedPages(client, 1, { hasMore: pages === Infinity })
    render(<InfiniteListHarness client={client} fetchPage={respondWithPages()} totalCount={totalCount} />)

    expect(screen.getByRole('table')).toHaveAttribute('aria-rowcount', expected)
    expect(document.querySelector('tr[data-table-header]')).toHaveAttribute('aria-rowindex', '1')
    expect(document.querySelector('tr[data-row-key="r0"]')).toHaveAttribute('aria-rowindex', '2')
    expect(document.querySelector('tr[data-row-key="r5"]')).toHaveAttribute('aria-rowindex', '7')
  })

  // Pilot check "Requests": "Weitere laden" is the way for keyboard users; it must not start a second parallel fetch.
  it('WHEN a keyboard user presses "Weitere laden" THEN one page loads and the button waits for it', async () => {
    const client = createListClient()
    seedLoadedPages(client, 1)
    const fetchPage = neverResolves()
    render(<InfiniteListHarness client={client} fetchPage={fetchPage} />)

    const loadMore = screen.getByRole('button', { name: infiniteDt.infinite.loadMore })
    expect(loadMore).toHaveClass('min-h-11')
    fireEvent.click(loadMore)
    await waitFor(() => expect(loadMore).toBeDisabled())
    fireEvent.click(loadMore)
    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('data-table-announcement')).toHaveTextContent(infiniteDt.infinite.loadingMore)
  })

  // Pilot check "Requests": retry after a failed page; the failure must not loop and loaded rows stay usable.
  it('WHEN a next page fails THEN loaded rows stay usable, nothing retries by itself and "Erneut laden" fetches again', async () => {
    const client = createListClient()
    seedLoadedPages(client, 1)
    const fetchPage = vi
      .fn<(request: PageRequest) => Promise<ReturnType<typeof pageOf>>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(pageOf(1))
    render(<InfiniteListHarness client={client} fetchPage={fetchPage} rowBehaviour={{ onRowClick: vi.fn() }} />)

    scrollTo(4100)
    expect(await screen.findByText(infiniteDt.infinite.loadMoreFailed, { selector: 'span' })).toBeInTheDocument()
    scrollTo(4200)
    scrollTo(4300)
    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(document.querySelector('tr[data-row-key="r0"]')).not.toHaveAttribute('aria-disabled')

    fireEvent.click(screen.getByRole('button', { name: infiniteDt.loading.retry }))
    await waitFor(() => expect(client.getQueryData<{ pages: unknown[] }>(listKey(''))?.pages).toHaveLength(2))
  })
})
