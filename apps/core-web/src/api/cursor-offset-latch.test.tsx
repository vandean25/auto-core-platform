import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  handshakeScopeContext,
  resetScopeContextClientForTests,
  SCOPE_CONTEXT_HEADER,
  seedValidatedScopeContextForTests,
} from '@/auth/scope-context-client'
import { scopedOffsetKey } from './offset-scope-gate'
import { fetchWithAuth } from './client'
import { isOffsetLatchedForEpisode, resetCursorRecoveryForTests } from './cursor-recovery'
import { inventoryKeys } from './inventory'
import { useInventoryListState } from './inventory-list'
import { useInvoiceListState } from './invoice-list'
import { useInvoiceCursorList } from './sales'
import { vehicleStockKeys } from './vehicle-stock'
import { useVehicleStockListState } from './vehicle-stock-list'

vi.mock('./client', () => ({ fetchWithAuth: vi.fn() }))

const testScope = { scopeContext: 'sc-test', scopeContextDigest: 'digest-latch' }

function wrapper(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const unsupportedCursor = {
  ok: false,
  status: 400,
  json: async () => ({ statusCode: 400, code: 'LIST_CURSOR_SORT_UNSUPPORTED', message: 'LIST_CURSOR_SORT_UNSUPPORTED' }),
} as Response

describe('LIST_CURSOR_SORT_UNSUPPORTED offset latch (ADR-0038)', () => {
  beforeEach(() => {
    resetScopeContextClientForTests()
    resetCursorRecoveryForTests()
    seedValidatedScopeContextForTests(testScope)
  })

  afterEach(() => vi.clearAllMocks())

  const offsetPagedLists = [
    {
      name: 'inventory',
      path: '/api/inventory',
      rowPrefix: 'inv',
      pageOneKey: scopedOffsetKey(inventoryKeys.list({ page: 1, pageSize: 10, sortField: 'sku', sortDirection: 'asc' }), testScope.scopeContextDigest),
      useList: (page: number) =>
        useInventoryListState({ page, pageSize: 10, sortField: 'sku', sortDirection: 'asc', filters: [] }, {}),
    },
    {
      name: 'vehicle stock',
      path: '/api/vehicle-stock',
      rowPrefix: 'vs',
      pageOneKey: scopedOffsetKey(
        vehicleStockKeys.list({
          page: 1,
          pageSize: 10,
          sortField: 'vin',
          sortDirection: 'asc',
          filters: [{ field: 'stock_status', value: 'IN_STOCK' }],
          search: undefined,
        }),
        testScope.scopeContextDigest,
      ),
      useList: (page: number) =>
        useVehicleStockListState({
          page,
          pageSize: 10,
          sortField: 'vin',
          sortDirection: 'asc',
          filters: [{ field: 'stock_status', value: 'IN_STOCK' }],
          search: undefined,
        }),
    },
  ]

  function mockOffsetPagedList(path: string, rowPrefix: string) {
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      const target = String(url)
      if (target.includes('capped-count')) {
        return { ok: true, json: async () => ({ count: 2, isCapped: false, scopeContextDigest: testScope.scopeContextDigest }) } as Response
      }
      if (target.includes(path) && !target.includes('pagination=cursor')) {
        const page = new URL(target, 'http://acp.test').searchParams.get('page') ?? '1'
        return {
          ok: true,
          json: async () => ({
            data: [{ id: `${rowPrefix}-page-${page}` }],
            meta: { total: 2, page: Number(page), pageSize: 10, pageCount: 2, scopeContextDigest: testScope.scopeContextDigest },
          }),
        } as Response
      }
      return unsupportedCursor
    })
  }

  const offsetPagesRequested = (path: string) =>
    vi
      .mocked(fetchWithAuth)
      .mock.calls.map((call) => String(call[0]))
      .filter((target) => target.includes(path) && !target.includes('pagination=cursor') && !target.includes('capped-count'))
      .map((target) => new URL(target, 'http://acp.test').searchParams.get('page'))

  // Regression: on an unsupported sort the offset list stayed on page 1 instead of the table page.
  it.each(offsetPagedLists)('$name requests page 1 on latch, then shows the table page', async ({ path, rowPrefix, useList }) => {
    mockOffsetPagedList(path, rowPrefix)
    const { result, rerender } = renderHook(({ page }: { page: number }) => useList(page), {
      initialProps: { page: 2 },
      wrapper: wrapper(),
    })

    await waitFor(() => expect(offsetPagesRequested(path)[0]).toBe('1'))
    await waitFor(() => expect(result.current.rows).toEqual([{ id: `${rowPrefix}-page-2` }]))
    expect(offsetPagesRequested(path)).toContain('2')

    rerender({ page: 2 })
    await waitFor(() => expect(result.current.rows).toEqual([{ id: `${rowPrefix}-page-2` }]))
  })

  // Regression: with the app's 5-minute stale time a cached page 1 was never re-read, so the handoff never
  // completed and the rows stayed on page 1 while the pager showed the table page.
  it.each(offsetPagedLists)('$name reads a fresh cached page 1 once on latch, then shows the table page', async ({ path, rowPrefix, useList, pageOneKey }) => {
    mockOffsetPagedList(path, rowPrefix)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5 * 60_000 } } })
    client.setQueryData(pageOneKey, {
      data: [{ id: `${rowPrefix}-cached` }],
      meta: { total: 2, page: 1, pageSize: 10, pageCount: 2 },
    })
    const { result } = renderHook(() => useList(2), { wrapper: wrapper(client) })

    await waitFor(() => expect(offsetPagesRequested(path)[0]).toBe('1'))
    await waitFor(() => expect(result.current.rows).toEqual([{ id: `${rowPrefix}-page-2` }]))
  })

  // Regression: a failed page-1 read never ended the handoff, so the list stayed on an empty page 1.
  it.each(offsetPagedLists)('$name requests the table page after a failed page-1 read', async ({ path, rowPrefix, useList }) => {
    mockOffsetPagedList(path, rowPrefix)
    const servePage = vi.mocked(fetchWithAuth).getMockImplementation()!
    vi.mocked(fetchWithAuth).mockImplementation(async (url, init) => {
      const target = String(url)
      const pageOne = new URL(target, 'http://acp.test').searchParams.get('page') === '1'
      if (target.includes(path) && !target.includes('pagination=cursor') && pageOne) return { ok: false, status: 500 } as Response
      return servePage(url, init)
    })
    const { result } = renderHook(() => useList(2), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.rows).toEqual([{ id: `${rowPrefix}-page-2` }]))
    expect(offsetPagesRequested(path)).toEqual(['1', '2'])
  })

  // Offset lists outside cursor mode: a non-cursor sort, "all statuses", a non-cursor invoice sort.
  const offsetModeLists = [
    {
      name: 'inventory',
      useList: () => useInventoryListState({ page: 1, pageSize: 10, sortField: 'location', sortDirection: 'asc', filters: [] }, {}),
      body: (id: string) => ({ data: [{ id }], meta: { total: 1, page: 1, pageSize: 10, pageCount: 1 } }),
    },
    {
      name: 'vehicle stock',
      useList: () => useVehicleStockListState({ page: 1, pageSize: 10, sortField: 'vin', sortDirection: 'asc', filters: [], search: undefined }),
      body: (id: string) => ({ data: [{ id }], meta: { total: 1, page: 1, pageSize: 10, pageCount: 1 } }),
    },
    {
      name: 'invoices',
      useList: () => useInvoiceListState({ page: 1, pageSize: 10, sortField: 'status', sortDirection: 'asc', filters: [] }),
      body: (id: string) => [{ id, invoice_number: 'INV-1', status: 'DRAFT', customer: { type: 'PERSON', first_name: 'A', last_name: 'B' } }],
    },
  ]

  // Regression: the offset fallbacks ignored the scope client and kept showing the previous scope's rows after an
  // external-scope handshake.
  it.each(offsetModeLists)('$name hides its rows after an external-scope handshake until "Liste aktualisieren"', async ({ useList, body }) => {
    vi.mocked(fetchWithAuth).mockImplementation(async (url, init) => {
      if (String(url).includes('/api/auth/scope-context')) {
        return {
          ok: true,
          json: async () => ({ scopeContext: 'sc-b', scopeContextDigest: 'digest-b', continuityDigest: testScope.scopeContextDigest }),
        } as Response
      }
      const scope = new Headers(init?.headers).get(SCOPE_CONTEXT_HEADER)
      return { ok: true, json: async () => body(scope === 'sc-b' ? 'row-new-scope' : 'row-previous-scope') } as Response
    })
    const { result } = renderHook(() => useList(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.rows.map((row) => row.id)).toEqual(['row-previous-scope']))

    await act(async () => {
      await handshakeScopeContext({ force: true })
    })

    expect(result.current.rows).toEqual([])
    const refresh = (result.current.tableProps as { onScopeRefresh?: () => Promise<void> }).onScopeRefresh
    expect(refresh).toBeDefined()
    await act(async () => {
      await refresh?.()
    })

    await waitFor(() => expect(result.current.rows.map((row) => row.id)).toEqual(['row-new-scope']))
  })

  // Regression: the invoice fallback list stayed on the page-1 slice while the pager showed page 2.
  it('invoices latch to the unpaged list and show the table page', async () => {
    const listParams = { sortField: 'invoice_number', sortDirection: 'asc' as const }
    const episodeKey = JSON.stringify({ search: '', sortField: 'invoice_number', sortDirection: 'asc' })
    const invoices = Array.from({ length: 11 }, (_, index) => ({
      id: `inv-doc-${index + 1}`,
      invoice_number: `INV-${index + 1}`,
      status: 'DRAFT',
      customer: { type: 'PERSON', first_name: 'A', last_name: 'B' },
    }))
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      const target = String(url)
      if (target.includes('capped-count')) {
        return { ok: true, json: async () => ({ count: 11, isCapped: false, scopeContextDigest: testScope.scopeContextDigest }) } as Response
      }
      if (target.includes('pagination=cursor')) return unsupportedCursor
      if (target.includes('/api/sales/invoices')) return { ok: true, json: async () => invoices } as Response
      return unsupportedCursor
    })
    renderHook(() => useInvoiceCursorList(listParams, true), { wrapper: wrapper() })
    await waitFor(() => expect(isOffsetLatchedForEpisode(episodeKey)).toBe(true))
    const { result } = renderHook(
      () => useInvoiceListState({ page: 2, pageSize: 10, sortField: 'invoice_number', sortDirection: 'asc', filters: [] }),
      { wrapper: wrapper() },
    )
    await waitFor(() => expect(result.current.rows.map((row) => row.id)).toEqual(['inv-doc-11']))
  })
})
