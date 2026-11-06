import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWithAuth } from './client'
import { CURSOR_PAGE_LIMIT, useCursorList } from './cursor-list'

vi.mock('./client', () => ({ fetchWithAuth: vi.fn() }))

type Row = { id: string }

const jsonResponse = (body: unknown): Response => ({ ok: true, json: async () => body }) as Response
const failure = (): Response => ({ ok: false, status: 500, json: async () => ({}) }) as Response
const searchOf = (call: unknown[]) => new URL(String(call[0]), 'http://acp.test')

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const options = (overrides: Partial<Parameters<typeof useCursorList<Row>>[0]> = {}) => ({
  enabled: true,
  path: '/api/inventory',
  countPath: '/api/inventory/capped-count',
  listKey: ['inventory', 'cursor', 'brake', 'sku'],
  countKey: ['inventory', 'capped-count', 'brake'],
  params: { search: 'brake', sortField: 'sku', sortDirection: 'asc' },
  countParams: { search: 'brake' },
  ...overrides,
})

/** Routes the list and the capped count of one mocked API. */
function mockApi({ pages, count }: { pages: Array<{ data: Row[]; nextCursor: string | null }>; count?: Response }) {
  let served = 0
  vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
    if (String(url).includes('capped-count')) return count ?? jsonResponse({ count: 3, isCapped: false })
    const page = pages[served++]
    return jsonResponse({ data: page.data, meta: { nextCursor: page.nextCursor, hasNextPage: page.nextCursor !== null } })
  })
}

describe('useCursorList', () => {
  afterEach(() => vi.clearAllMocks())

  // Regression: a cursor list that kept sending page/pageSize (or dropped the filters) would silently fall back to
  // offset paging on the server or load a different result set for the next block.
  it('asks for cursor mode with the block size and follows nextCursor with the same filters and sort', async () => {
    mockApi({ pages: [{ data: [{ id: 'a' }], nextCursor: 'cur-1' }, { data: [{ id: 'b' }], nextCursor: null }] })
    const { result } = renderHook(() => useCursorList<Row>(options()), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.rows).toEqual([{ id: 'a' }]))
    expect(result.current.tableProps.infinite.hasNextPage).toBe(true)
    await act(async () => {
      await result.current.tableProps.infinite.fetchNextPage()
    })

    await waitFor(() => expect(result.current.rows).toEqual([{ id: 'a' }, { id: 'b' }]))
    const listCalls = vi.mocked(fetchWithAuth).mock.calls.filter((call) => !String(call[0]).includes('capped-count'))
    const [first, next] = listCalls.map((call) => Object.fromEntries(searchOf(call).searchParams))
    expect(first).toEqual({ pagination: 'cursor', limit: String(CURSOR_PAGE_LIMIT), search: 'brake', sortField: 'sku', sortDirection: 'asc' })
    expect(next).toEqual({ ...first, cursor: 'cur-1' })
    expect(result.current.tableProps.infinite.hasNextPage).toBe(false)
  })

  // Regression: the count must describe the filters only; a sort in the count request would re-key and re-run it per sort.
  it('requests the capped count with the filters but without sort, paging or cursor', async () => {
    mockApi({ pages: [{ data: [], nextCursor: null }], count: jsonResponse({ count: 1000, isCapped: true }) })
    const { result } = renderHook(() => useCursorList<Row>(options()), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.tableProps.infinite.totalCount).toEqual({ count: 1000, isCapped: true }))
    const countCall = vi.mocked(fetchWithAuth).mock.calls.find((call) => String(call[0]).includes('capped-count'))
    expect(countCall).toBeDefined()
    const url = searchOf(countCall as unknown[])
    expect(url.pathname).toBe('/api/inventory/capped-count')
    expect(Object.fromEntries(url.searchParams)).toEqual({ search: 'brake' })
  })

  // Regression: an offset-mode page (non-cursor sort) must not also hit the cursor endpoints.
  it('sends no request while disabled', () => {
    mockApi({ pages: [] })
    const { result } = renderHook(() => useCursorList<Row>(options({ enabled: false })), { wrapper: wrapper() })

    expect(fetchWithAuth).not.toHaveBeenCalled()
    expect(result.current.rows).toEqual([])
  })

  // Regression (ADR-0035 §5): a failing counter must not blank the rows; it only offers a retry.
  it('keeps the rows and flags the count error when only the capped count fails', async () => {
    mockApi({ pages: [{ data: [{ id: 'a' }], nextCursor: null }], count: failure() })
    const { result } = renderHook(() => useCursorList<Row>(options()), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.tableProps.infinite.isCountError).toBe(true))
    expect(result.current.rows).toEqual([{ id: 'a' }])
    expect(result.current.tableProps.isError).toBe(false)
    expect(result.current.tableProps.infinite.totalCount).toBeUndefined()
  })

  it('reports a failed first page as a list error and loads the rows when the retry succeeds', async () => {
    let failing = true
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      if (String(url).includes('capped-count')) return jsonResponse({ count: 1, isCapped: false })
      return failing ? failure() : jsonResponse({ data: [{ id: 'a' }], meta: { nextCursor: null, hasNextPage: false } })
    })
    const { result } = renderHook(() => useCursorList<Row>(options()), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.tableProps.isError).toBe(true))
    expect(result.current.rows).toEqual([])

    failing = false
    act(() => result.current.tableProps.onRetry())
    await waitFor(() => expect(result.current.rows).toEqual([{ id: 'a' }]))
    expect(result.current.tableProps.isError).toBe(false)
  })
})
