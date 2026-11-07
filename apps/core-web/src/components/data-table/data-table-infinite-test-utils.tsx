import { QueryClient, QueryClientProvider, useInfiniteQuery } from '@tanstack/react-query'
import type { ColumnFiltersState, PaginationState, SortingState } from '@tanstack/react-table'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { act, fireEvent, screen } from '@testing-library/react'
import { useMemo, useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

import { infiniteListQueryOptions } from '@/lib/infinite-list-query'
import { DataTable } from './DataTable'
import type { DataTableInfiniteProps } from './data-table-props'
import type { DataTableRowBehaviour } from './data-table-row-behaviour'
import deCommon from '../../../../../locales/de/common.json'

export const dt = deCommon.dataTable

// Plain test labels, kept out of JSX so the i18n lint rule (which exempts only *.test.tsx files) has nothing to flag.
const FILTER_A_LABEL = 'Filter A'
const FILTER_B_LABEL = 'Filter B'
const SORT_LABEL = 'Sort Z'
const selectedCountLabel = (count: number) => `${count} gewählt`

export type InfiniteRow = { id: string; name: string }
type PageResponse = { data: InfiniteRow[]; meta: { nextCursor: number | null; hasNextPage: boolean } }
export type PageRequest = { page: number; filter: string }

export const PAGE_SIZE = 100
export const ROW_HEIGHT = 49 // the comfortable estimate, so cached restores land where they were left
export const VIEWPORT_HEIGHT = 600
export const HEADER_HEIGHT = 44

/** Page `page` of a list with `pages` pages in total (`hasMore` forces a next cursor on the last one). */
export function pageOf(page: number, { pages = Infinity, size = PAGE_SIZE } = {}): PageResponse {
  const hasNextPage = page + 1 < pages
  return {
    data: Array.from({ length: size }, (_, index) => ({ id: `r${page * size + index}`, name: `Zeile ${page * size + index}` })),
    meta: { nextCursor: hasNextPage ? page + 1 : null, hasNextPage },
  }
}

export const listKey = (filter: string) => ['infinite-rows', { filter }] as const

export function createListClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

/** A list whose first `pages` pages are already in the cache, as after scrolling or coming back from a detail view. */
export function seedLoadedPages(client: QueryClient, pages: number, { filter = '', hasMore = true } = {}) {
  client.setQueryData(listKey(filter), {
    pages: Array.from({ length: pages }, (_, page) => pageOf(page, { pages: hasMore ? Infinity : pages })),
    pageParams: Array.from({ length: pages }, (_, page) => page),
  })
}

const columns: ColumnDef<InfiniteRow>[] = [{ accessorKey: 'name', header: 'Name', meta: { mobile: 'title' } }]

type HarnessProps = {
  client: QueryClient
  fetchPage: (request: PageRequest) => Promise<PageResponse>
  rowBehaviour?: DataTableRowBehaviour<InfiniteRow>
  withSelection?: boolean
  totalCount?: DataTableInfiniteProps['totalCount']
  isCountError?: boolean
  retryCount?: () => void
  /** An old `?page=3` link arrives as a non-zero page index. */
  initialPageIndex?: number
}

function InfiniteListBody({
  fetchPage,
  rowBehaviour,
  withSelection,
  totalCount,
  isCountError,
  retryCount,
  initialPageIndex = 0,
}: Omit<HarnessProps, 'client'>) {
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [sorting, setSorting] = useState<SortingState>([])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: initialPageIndex, pageSize: PAGE_SIZE })
  const filter = String(columnFilters[0]?.value ?? '')
  const query = useInfiniteQuery({
    ...infiniteListQueryOptions(),
    queryKey: listKey(filter),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchPage({ page: pageParam, filter }),
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  })
  const data = useMemo(() => query.data?.pages.flatMap((page) => page.data) ?? [], [query.data])

  return (
    <>
      <output data-testid="page-index">{pagination.pageIndex}</output>
      <button type="button" onClick={() => setColumnFilters([])}>{FILTER_A_LABEL}</button>
      <button type="button" onClick={() => setColumnFilters([{ id: 'name', value: 'B' }])}>{FILTER_B_LABEL}</button>
      <button type="button" onClick={() => setSorting([{ id: 'name', desc: true }])}>{SORT_LABEL}</button>
      <DataTable<InfiniteRow>
        columns={columns}
        data={data}
        isLoading={query.isLoading}
        isFetching={query.isFetching}
        isPlaceholderData={query.isPlaceholderData}
        isError={query.isError}
        hasUsableData={data.length > 0}
        columnFilters={columnFilters}
        setColumnFilters={setColumnFilters}
        sorting={sorting}
        setSorting={setSorting}
        pagination={pagination}
        setPagination={setPagination}
        rowBehaviour={rowBehaviour}
        bulkActions={withSelection ? (rows) => <span>{selectedCountLabel(rows.length)}</span> : undefined}
        infinite={{
          queryKey: listKey(filter),
          hasNextPage: query.hasNextPage,
          isFetchingNextPage: query.isFetchingNextPage,
          isFetchNextPageError: query.isFetchNextPageError,
          fetchNextPage: query.fetchNextPage,
          totalCount,
          isCountError,
          retryCount,
        }}
      />
    </>
  )
}

/** A real `useInfiniteQuery` behind the table, so tests exercise the actual query lifecycle. */
export function InfiniteListHarness({ client, ...props }: HarnessProps) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <InfiniteListBody {...props} />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

/** jsdom has no layout: give the scroll box a viewport and every row a height, and make scrollTo move scrollTop. */
export function mockListLayout() {
  const spies = [
    // The virtualizer reads the viewport and every measured row from offsetHeight.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('role') === 'region') return VIEWPORT_HEIGHT
      return this.matches('tr[data-index], li[data-index]') ? ROW_HEIGHT : 0
    }),
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800),
    // A list that starts at the top of the page moves up as the page scrolls.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ x: 0, y: 0, top: -window.scrollY, left: 0, right: 800, bottom: 0, width: 800, height: 0, toJSON: () => ({}) }),
    ),
  ]
  const scrollTo = Element.prototype.scrollTo
  Element.prototype.scrollTo = function (this: Element, options?: ScrollToOptions | number) {
    this.scrollTop = typeof options === 'object' ? (options.top ?? 0) : 0
    // A browser reports the scroll after the current task, never from inside a React lifecycle.
    queueMicrotask(() => this.dispatchEvent(new Event('scroll')))
  }
  return () => {
    spies.forEach((spy) => spy.mockRestore())
    Element.prototype.scrollTo = scrollTo
  }
}

/**
 * The virtualizer ends a scroll 150 ms after the last scroll event, also on an unmounted table. Awaited in `afterAll`
 * of a file that scrolls, it keeps that timer from firing after jsdom is gone ("window is not defined", an unhandled
 * error that fails the whole run on a slow runner).
 */
export const settleVirtualizerTimers = () => new Promise<void>((resolve) => setTimeout(resolve, 200))

export const scrollRegion = () => screen.getByRole('region', { name: dt.scrollRegion })

export function scrollTo(top: number) {
  act(() => {
    const region = scrollRegion()
    region.scrollTop = top
    fireEvent.scroll(region)
  })
}

export const renderedRowIds = () =>
  [...document.querySelectorAll<HTMLElement>('tr[data-row-key]')].map((row) => row.dataset.rowKey as string)
