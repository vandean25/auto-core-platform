import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { inventoryKeys } from './inventory'
import { useCreateDraftInvoice, useIssueInvoice, useUpdateInvoiceDiscount } from './invoices'
import { useReceiveGoods } from './purchase-orders'
import { invoiceKeys, useFinalizeInvoice, useUpdateInvoice } from './sales'
import { workshopKeys } from './workshop'

const mocks = vi.hoisted(() => ({
  fetchWithAuth: vi.fn(),
}))

vi.mock('./client', () => ({
  fetchWithAuth: mocks.fetchWithAuth,
}))

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function jsonOk(body: unknown) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue(body),
  }
}

describe('query-key factory invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refreshes the invoice detail screen after an invoice update', async () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(invoiceKeys.detail('inv-1'), { id: 'inv-1', status: 'DRAFT' })
    mocks.fetchWithAuth.mockResolvedValue(jsonOk({ id: 'inv-1', status: 'DRAFT' }))

    const { result } = renderHook(() => useUpdateInvoice(), { wrapper: createWrapper(queryClient) })

    await result.current.mutateAsync({
      id: 'inv-1',
      payload: {
        customerId: 'cust-1',
        items: [{ description: 'Labor', quantity: 1, unitPrice: 80, taxRate: 0.2 }],
      },
    })

    await waitFor(() => {
      expect(queryClient.getQueryState(invoiceKeys.detail('inv-1'))?.isInvalidated).toBe(true)
    })
  })

  it('refreshes the invoice detail screen after finalize', async () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(invoiceKeys.detail('inv-1'), { id: 'inv-1', status: 'DRAFT' })
    mocks.fetchWithAuth.mockResolvedValue(jsonOk({ id: 'inv-1', status: 'ISSUED' }))

    const { result } = renderHook(() => useFinalizeInvoice(), { wrapper: createWrapper(queryClient) })

    await result.current.mutateAsync('inv-1')

    await waitFor(() => {
      expect(queryClient.getQueryState(invoiceKeys.detail('inv-1'))?.isInvalidated).toBe(true)
    })
  })

  it('refreshes workshop order list and detail after creating a draft invoice', async () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(workshopKeys.orders(), { data: [] })
    queryClient.setQueryData(workshopKeys.order('wo-1'), { id: 'wo-1' })
    mocks.fetchWithAuth.mockResolvedValue(jsonOk({ id: 'inv-1', workshop_order_id: 'wo-1' }))

    const { result } = renderHook(() => useCreateDraftInvoice(), { wrapper: createWrapper(queryClient) })

    await result.current.mutateAsync('wo-1')

    await waitFor(() => {
      expect(queryClient.getQueryState(workshopKeys.orders())?.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(workshopKeys.order('wo-1'))?.isInvalidated).toBe(true)
    })
  })

  it('writes the issued invoice into the invoice cache and refreshes the workshop order screens', async () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(invoiceKeys.detail('inv-1'), { id: 'inv-1', status: 'DRAFT' })
    queryClient.setQueryData(workshopKeys.orders(), { data: [] })
    queryClient.setQueryData(workshopKeys.order('wo-1'), { id: 'wo-1' })

    const issuedInvoice = { id: 'inv-1', status: 'ISSUED', workshop_order_id: 'wo-1' }
    mocks.fetchWithAuth.mockResolvedValue(jsonOk(issuedInvoice))

    const { result } = renderHook(() => useIssueInvoice(), { wrapper: createWrapper(queryClient) })

    await result.current.mutateAsync('inv-1')

    await waitFor(() => {
      expect(queryClient.getQueryData(invoiceKeys.detail('inv-1'))).toEqual(issuedInvoice)
      expect(queryClient.getQueryState(workshopKeys.orders())?.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(workshopKeys.order('wo-1'))?.isInvalidated).toBe(true)
    })
  })

  it('writes discount updates into the invoice detail cache', async () => {
    const queryClient = createQueryClient()
    const updatedInvoice = { id: 'inv-1', global_discount_value: 10 }
    mocks.fetchWithAuth.mockResolvedValue(jsonOk(updatedInvoice))

    const { result } = renderHook(() => useUpdateInvoiceDiscount(), { wrapper: createWrapper(queryClient) })

    await result.current.mutateAsync({
      invoiceId: 'inv-1',
      payload: { globalDiscountValue: 10 },
    })

    await waitFor(() => {
      expect(queryClient.getQueryData(invoiceKeys.detail('inv-1'))).toEqual(updatedInvoice)
    })
  })

  it('refreshes inventory lists after receiving PO goods', async () => {
    const queryClient = createQueryClient()
    const inventoryListKey = inventoryKeys.list({ page: 1 })
    queryClient.setQueryData(inventoryListKey, { data: [], meta: { total: 0, page: 1, limit: 10, pageCount: 1 } })
    mocks.fetchWithAuth.mockResolvedValue(jsonOk({ id: 'po-1' }))

    const { result } = renderHook(() => useReceiveGoods(), { wrapper: createWrapper(queryClient) })

    await result.current.mutateAsync({
      orderId: 'po-1',
      items: [{ itemId: 'item-1', quantity: 2 }],
    })

    await waitFor(() => {
      expect(queryClient.getQueryState(inventoryListKey)?.isInvalidated).toBe(true)
    })
  })
})
