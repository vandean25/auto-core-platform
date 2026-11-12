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

  it('inventory requests page 1 on latch then honors later pages', async () => {
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      const target = String(url)
      if (target.includes('capped-count')) {
        return { ok: true, json: async () => ({ count: 2, isCapped: false, scopeContextDigest: testScope.scopeContextDigest }) } as Response
      }
      if (target.includes('/api/inventory') && target.includes('pagination=cursor')) {
        return unsupportedCursor
      }
      if (target.includes('/api/inventory?')) {
        const page = new URL(target, 'http://acp.test').searchParams.get('page') ?? '1'
        return {
          ok: true,
          json: async () => ({
            data: [{ id: `inv-page-${page}` }],
            meta: { total: 2, page: Number(page), pageSize: 10, pageCount: 2, scopeContextDigest: testScope.scopeContextDigest },
          }),
        } as Response
      }
      return unsupportedCursor
    })
    const { result, rerender } = renderHook(
      ({ page }: { page: number }) =>
        useInventoryListState({ page, pageSize: 10, sortField: 'sku', sortDirection: 'asc', filters: [] }, {}),
      { initialProps: { page: 2 }, wrapper: wrapper() },
    )
    const inventoryOffsetPages = () =>
      vi
        .mocked(fetchWithAuth)
        .mock.calls.filter(
          (call) => String(call[0]).includes('/api/inventory?') && !String(call[0]).includes('pagination=cursor'),
        )
        .map((call) => new URL(String(call[0]), 'http://acp.test').searchParams.get('page'))

    await waitFor(() => expect(inventoryOffsetPages()[0]).toBe('1'))
    await waitFor(() => expect(result.current.rows).toEqual([{ id: 'inv-page-2' }]))
    expect(inventoryOffsetPages()).toContain('2')

    rerender({ page: 2 })
    await waitFor(() => expect(result.current.rows).toEqual([{ id: 'inv-page-2' }]))
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

  it('vehicle stock requests page 1 on latch then honors later pages', async () => {
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      const target = String(url)
      if (target.includes('capped-count')) {
        return { ok: true, json: async () => ({ count: 2, isCapped: false, scopeContextDigest: testScope.scopeContextDigest }) } as Response
      }
      if (target.includes('/api/vehicle-stock') && target.includes('pagination=cursor')) {
        return unsupportedCursor
      }
      if (target.includes('/api/vehicle-stock') && !target.includes('capped-count')) {
        const page = new URL(target, 'http://acp.test').searchParams.get('page') ?? '1'
        return {
          ok: true,
          json: async () => ({
            data: [{ id: `vs-page-${page}` }],
            meta: { total: 2, page: Number(page), pageSize: 10, pageCount: 2, scopeContextDigest: testScope.scopeContextDigest },
          }),
        } as Response
      }
      return unsupportedCursor
    })
    const queryParams = {
      pageSize: 10,
      sortField: 'vin' as const,
      sortDirection: 'asc' as const,
      filters: [{ field: 'stock_status' as const, value: 'IN_STOCK' as const }],
      search: undefined,
    }
    const { result, rerender } = renderHook(
      ({ page }: { page: number }) => useVehicleStockListState({ ...queryParams, page }),
      { initialProps: { page: 2 }, wrapper: wrapper() },
    )
    const vehicleOffsetPages = () =>
      vi
        .mocked(fetchWithAuth)
        .mock.calls.filter(
          (call) =>
            String(call[0]).includes('/api/vehicle-stock') &&
            !String(call[0]).includes('pagination=cursor') &&
            !String(call[0]).includes('capped-count'),
        )
        .map((call) => new URL(String(call[0]), 'http://acp.test').searchParams.get('page'))

    await waitFor(() => expect(vehicleOffsetPages()[0]).toBe('1'))
    await waitFor(() => expect(result.current.rows).toEqual([{ id: 'vs-page-2' }]))
    expect(vehicleOffsetPages()).toContain('2')
    rerender({ page: 2 })
    await waitFor(() => expect(result.current.rows).toEqual([{ id: 'vs-page-2' }]))
  })
})
