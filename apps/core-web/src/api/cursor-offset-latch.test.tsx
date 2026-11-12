import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetScopeContextClientForTests, seedValidatedScopeContextForTests } from '@/auth/scope-context-client'
import { fetchWithAuth } from './client'
import { isOffsetLatchedForEpisode, resetCursorRecoveryForTests } from './cursor-recovery'
import { useInventoryListState } from './inventory-list'
import { useInvoiceListState } from './invoice-list'
import { useInvoiceCursorList } from './sales'
import { useVehicleStockListState } from './vehicle-stock-list'

vi.mock('./client', () => ({ fetchWithAuth: vi.fn() }))

const testScope = { scopeContext: 'sc-test', scopeContextDigest: 'digest-latch' }

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const unsupportedCursor = {
  ok: false,
  status: 400,
  json: async () => ({ statusCode: 400, code: 'LIST_CURSOR_SORT_UNSUPPORTED', message: 'LIST_CURSOR_SORT_UNSUPPORTED' }),
} as Response

function seedMocks(options: {
  cursorPath: string
  offsetPath: string
  offsetRow: { id: string }
  cursorParams?: string
}) {
  vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
    const target = String(url)
    if (target.includes('capped-count')) {
      return { ok: true, json: async () => ({ count: 1, isCapped: false, scopeContextDigest: testScope.scopeContextDigest }) } as Response
    }
    if (target.includes(options.cursorPath) && target.includes('pagination=cursor')) {
      return unsupportedCursor
    }
    if (target.includes(options.offsetPath)) {
      return {
        ok: true,
        json: async () => ({
          data: [options.offsetRow],
          meta: { total: 1, page: 1, pageSize: 10, pageCount: 1, scopeContextDigest: testScope.scopeContextDigest },
        }),
      } as Response
    }
    return unsupportedCursor
  })
}

describe('LIST_CURSOR_SORT_UNSUPPORTED offset latch (ADR-0038)', () => {
  beforeEach(() => {
    resetScopeContextClientForTests()
    resetCursorRecoveryForTests()
    seedValidatedScopeContextForTests(testScope)
  })

  afterEach(() => vi.clearAllMocks())

  it('inventory renders offset list at page 1', async () => {
    seedMocks({ cursorPath: '/api/inventory', offsetPath: '/api/inventory?', offsetRow: { id: 'inv-1' } })
    const { result } = renderHook(
      () => useInventoryListState({ page: 2, pageSize: 10, sortField: 'sku', sortDirection: 'asc', filters: [] }, {}),
      { wrapper: wrapper() },
    )
    await waitFor(() => expect(result.current.rows).toEqual([{ id: 'inv-1' }]))
    const offsetCall = vi
      .mocked(fetchWithAuth)
      .mock.calls.find((call) => String(call[0]).includes('/api/inventory?') && !String(call[0]).includes('pagination=cursor'))
    expect(offsetCall).toBeDefined()
    expect(new URL(String(offsetCall![0]), 'http://acp.test').searchParams.get('page')).toBe('1')
  })

  it('invoices latch hands off to unpaged list at page 1', async () => {
    const listParams = { sortField: 'invoice_number', sortDirection: 'asc' as const }
    const episodeKey = JSON.stringify({ search: '', sortField: 'invoice_number', sortDirection: 'asc' })
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      const target = String(url)
      if (target.includes('capped-count')) {
        return { ok: true, json: async () => ({ count: 1, isCapped: false, scopeContextDigest: testScope.scopeContextDigest }) } as Response
      }
      if (target.includes('pagination=cursor')) return unsupportedCursor
      if (target.includes('/api/sales/invoices') && !target.includes('capped-count')) {
        return {
          ok: true,
          json: async () => [
            {
              id: 'inv-doc-1',
              invoice_number: 'INV-1',
              status: 'DRAFT',
              customer: { type: 'PERSON', first_name: 'A', last_name: 'B' },
            },
          ],
        } as Response
      }
      return unsupportedCursor
    })
    renderHook(() => useInvoiceCursorList(listParams, true), { wrapper: wrapper() })
    await waitFor(() => expect(isOffsetLatchedForEpisode(episodeKey)).toBe(true))
    const { result } = renderHook(
      () => useInvoiceListState({ page: 2, pageSize: 10, sortField: 'invoice_number', sortDirection: 'asc', filters: [] }),
      { wrapper: wrapper() },
    )
    await waitFor(() => expect(result.current.rows.map((row) => row.id)).toEqual(['inv-doc-1']))
  })

  it('vehicle stock renders offset list at page 1', async () => {
    seedMocks({ cursorPath: '/api/vehicle-stock', offsetPath: '/api/vehicle-stock', offsetRow: { id: 'vs-1' } })
    const { result } = renderHook(
      () =>
        useVehicleStockListState({
          page: 2,
          pageSize: 10,
          sortField: 'vin',
          sortDirection: 'asc',
          filters: [{ field: 'stock_status', value: 'IN_STOCK' }],
          search: undefined,
        }),
      { wrapper: wrapper() },
    )
    await waitFor(() => expect(result.current.rows).toEqual([{ id: 'vs-1' }]))
    const offsetCall = vi
      .mocked(fetchWithAuth)
      .mock.calls.find(
        (call) =>
          String(call[0]).includes('/api/vehicle-stock') &&
          !String(call[0]).includes('pagination=cursor') &&
          !String(call[0]).includes('capped-count'),
      )
    expect(offsetCall).toBeDefined()
    expect(new URL(String(offsetCall![0]), 'http://acp.test').searchParams.get('page')).toBe('1')
  })
})
