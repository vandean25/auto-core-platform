import type { ReactNode } from 'react'
import { createElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchWithAuth } from '@/api/client'
import { workshopCommunicationKeys } from '@/api/workshop-communications'
import {
  fetchWorkshopEstimatePdfError,
  fetchWorkshopOrderEstimate,
  useCreateWorkshopEstimate,
  useRecordWorkshopEstimateDecision,
  useReviseWorkshopEstimate,
  useSendWorkshopEstimateVersion,
  workshopEstimateKeys,
  workshopEstimatePdfFilename,
  workshopEstimatePdfPath,
} from './workshop-estimates'

vi.mock('@/api/client', () => ({ fetchWithAuth: vi.fn() }))

const fetchMock = vi.mocked(fetchWithAuth)

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function wrapperFor(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children)
}

beforeEach(() => {
  fetchMock.mockReset()
})

describe('workshop estimate API helpers', () => {
  it('returns the single estimate of an order, or null when none exists', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }))
    await expect(fetchWorkshopOrderEstimate('order-1')).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledWith('/api/workshop/orders/order-1/estimates')

    const estimate = { id: 'est-1', estimate_number: 'KV-2026-0001', versions: [] }
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [estimate] }))
    await expect(fetchWorkshopOrderEstimate('order-1')).resolves.toEqual(estimate)
  })

  it('reads the safe render error from the version, and reports none when the version is unavailable', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 'v1', pdf_generation_error: 'PDF generation failed. Please try again or contact support.' }),
    )
    await expect(fetchWorkshopEstimatePdfError('v1')).resolves.toBe(
      'PDF generation failed. Please try again or contact support.',
    )

    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Not found' }, 404))
    await expect(fetchWorkshopEstimatePdfError('v1')).resolves.toBeNull()
  })

  it('builds the PDF path and a sanitised, per-version file name', () => {
    expect(workshopEstimatePdfPath('v2')).toBe('/api/workshop/estimates/v2/pdf')
    expect(workshopEstimatePdfFilename('KV-2026-0001', 2)).toBe('kostenvoranschlag_kv_2026_0001_v2.pdf')
  })

  it('keeps one key factory per estimate domain, scoped by order and version', () => {
    expect(workshopEstimateKeys.order('order-1')).toEqual(['workshop', 'estimates', 'order', 'order-1'])
    expect(workshopEstimateKeys.version('v1')).toEqual(['workshop', 'estimates', 'version', 'v1'])
  })
})

describe('workshop estimate mutations', () => {
  it('creates an estimate on the order and refreshes the order estimate', async () => {
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'est-1' }, 201))

    const { result } = renderHook(() => useCreateWorkshopEstimate(), { wrapper: wrapperFor(queryClient) })
    await result.current.mutateAsync('order-1')

    expect(fetchMock).toHaveBeenCalledWith('/api/workshop/orders/order-1/estimates', { method: 'POST' })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: workshopEstimateKeys.order('order-1') })
  })

  it('surfaces the backend message when sending is refused', async () => {
    const queryClient = new QueryClient()
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 'ESTIMATE_SEND_DISABLED', message: 'Sending estimates to customers is disabled.' }, 503),
    )

    const { result } = renderHook(() => useSendWorkshopEstimateVersion(), { wrapper: wrapperFor(queryClient) })
    await expect(result.current.mutateAsync({ orderId: 'order-1', versionId: 'v1' })).rejects.toThrow(
      'Sending estimates to customers is disabled.',
    )
    expect(fetchMock).toHaveBeenCalledWith('/api/workshop/estimates/v1/send', { method: 'POST' })
  })

  it('a send refreshes the order estimate and its communication timeline', async () => {
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'v1', status: 'SENT' }))

    const { result } = renderHook(() => useSendWorkshopEstimateVersion(), { wrapper: wrapperFor(queryClient) })
    await result.current.mutateAsync({ orderId: 'order-1', versionId: 'v1' })

    expect(invalidate).toHaveBeenCalledWith({ queryKey: workshopEstimateKeys.order('order-1') })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: workshopCommunicationKeys.order('order-1') })
  })

  it('sends the email flag as a JSON body only when the customer is to be emailed', async () => {
    const queryClient = new QueryClient()
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'v1', status: 'SENT' }))

    const { result } = renderHook(() => useSendWorkshopEstimateVersion(), { wrapper: wrapperFor(queryClient) })
    await result.current.mutateAsync({ orderId: 'order-1', versionId: 'v1', notifyCustomerByEmail: true })

    expect(fetchMock).toHaveBeenCalledWith('/api/workshop/estimates/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notifyCustomerByEmail: true }),
    })
  })

  it('sends no body when the flag is false, as before', async () => {
    const queryClient = new QueryClient()
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'v1', status: 'SENT' }))

    const { result } = renderHook(() => useSendWorkshopEstimateVersion(), { wrapper: wrapperFor(queryClient) })
    await result.current.mutateAsync({ orderId: 'order-1', versionId: 'v1', notifyCustomerByEmail: false })

    expect(fetchMock).toHaveBeenCalledWith('/api/workshop/estimates/v1/send', { method: 'POST' })
  })

  it('keeps the error code and status on a refused send', async () => {
    const queryClient = new QueryClient()
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'ESTIMATE_CUSTOMER_EMAIL_MISSING', message: 'Keine E-Mail.' }, 422))

    const { result } = renderHook(() => useSendWorkshopEstimateVersion(), { wrapper: wrapperFor(queryClient) })
    await expect(
      result.current.mutateAsync({ orderId: 'order-1', versionId: 'v1', notifyCustomerByEmail: true }),
    ).rejects.toMatchObject({ status: 422, data: { code: 'ESTIMATE_CUSTOMER_EMAIL_MISSING' } })
  })

  it('reports success once the send is accepted', async () => {
    const queryClient = new QueryClient()
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'v1', status: 'SENT' }))

    const { result } = renderHook(() => useSendWorkshopEstimateVersion(), { wrapper: wrapperFor(queryClient) })
    result.current.mutate({ orderId: 'order-1', versionId: 'v1' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})

describe('estimate mutations refresh the estimates lists', () => {
  const LIST_KEY = workshopEstimateKeys.list({ status: 'SENT' })

  it('keys the lists under one prefix', () => {
    expect(workshopEstimateKeys.lists()).toEqual(['workshop', 'estimates', 'list'])
    expect(LIST_KEY.slice(0, 3)).toEqual(workshopEstimateKeys.lists())
  })

  it.each([
    ['create', () => useCreateWorkshopEstimate(), 'order-1'],
    ['revise', () => useReviseWorkshopEstimate(), 'order-1'],
    ['send', () => useSendWorkshopEstimateVersion(), { orderId: 'order-1', versionId: 'ver-1' }],
    [
      'decision',
      () => useRecordWorkshopEstimateDecision(),
      { orderId: 'order-1', versionId: 'ver-1', body: { decision: 'APPROVED' } },
    ],
  ] as const)('after %s', async (_name, useHook, variables) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    queryClient.setQueryData(LIST_KEY, { pages: [], pageParams: [] })
    fetchMock.mockResolvedValue(jsonResponse({}))
    const { result } = renderHook(() => useHook(), { wrapper: wrapperFor(queryClient) })
    expect(queryClient.getQueryState(LIST_KEY)?.isInvalidated).toBe(false)

    await act(async () => {
      await (result.current.mutateAsync as (input: unknown) => Promise<unknown>)(variables)
    })

    expect(queryClient.getQueryState(LIST_KEY)?.isInvalidated).toBe(true)
  })
})
