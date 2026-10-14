import type { ReactNode } from 'react'
import { createElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchWithAuth } from '@/api/client'
import {
  fetchWorkshopOrderCommunications,
  useWorkshopOrderCommunications,
  workshopCommunicationKeys,
} from './workshop-communications'

vi.mock('@/api/client', () => ({ fetchWithAuth: vi.fn() }))

const fetchMock = vi.mocked(fetchWithAuth)

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const ENTRY = {
  id: 'outbox-1',
  kind: 'ESTIMATE_EMAIL',
  channel: 'EMAIL',
  version: 1,
  occurred_at: '2026-10-10T08:05:00.000Z',
  status: 'SENT',
  decision: null,
} as const

describe('workshop communications API', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('reads the timeline of one order, in the order the server returns it', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [ENTRY] }))

    await expect(fetchWorkshopOrderCommunications('order-1')).resolves.toEqual([ENTRY])
    expect(fetchMock).toHaveBeenCalledWith('/api/workshop/orders/order-1/communications')
  })

  it('throws the German message with the status when the timeline cannot be read', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Forbidden' }, 403))

    await expect(fetchWorkshopOrderCommunications('order-1')).rejects.toMatchObject({
      message: 'Kommunikation konnte nicht geladen werden.',
      status: 403,
    })
  })

  it('keys each timeline by its order, so one order never shows another order’s entries', () => {
    expect(workshopCommunicationKeys.order('order-1')).toEqual(['workshop', 'communications', 'order-1'])
    expect(workshopCommunicationKeys.order('order-2')).not.toEqual(workshopCommunicationKeys.order('order-1'))
  })

  it('loads the timeline through the hook', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [ENTRY] }))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)

    const { result } = renderHook(() => useWorkshopOrderCommunications('order-1'), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([ENTRY])
  })
})
