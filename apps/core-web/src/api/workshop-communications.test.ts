import type { ReactNode } from 'react'
import { createElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchWithAuth } from '@/api/client'
import {
  communicationRefetchInterval,
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

  it('reads the timeline with no stale time, and a polling rule that follows its entries', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: [{ ...ENTRY, status: 'QUEUED', occurred_at: new Date().toISOString() }] }),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)

    const { result } = renderHook(() => useWorkshopOrderCommunications('order-1'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const query = queryClient.getQueryCache().find({ queryKey: workshopCommunicationKeys.order('order-1') })
    // The observer options are not part of the public Query type, so they are read as a plain object.
    const options = query?.options as { staleTime?: number; refetchInterval?: unknown } | undefined
    expect(options?.staleTime).toBe(0)
    const refetchInterval = options?.refetchInterval as (query: { state: { data: unknown } }) => number | false
    expect(refetchInterval({ state: { data: result.current.data } })).toBe(5_000)
    expect(refetchInterval({ state: { data: [{ ...ENTRY, status: 'SENT' }] } })).toBe(false)
  })
})

describe('communicationRefetchInterval', () => {
  const NOW = Date.parse('2026-10-14T12:00:00.000Z')
  const entryAt = (status: 'QUEUED' | 'SENT', minutesAgo: number) => ({
    ...ENTRY,
    status,
    occurred_at: new Date(NOW - minutesAgo * 60_000).toISOString(),
  })

  it('polls every five seconds while an email queued in the last ten minutes is still QUEUED', () => {
    expect(communicationRefetchInterval([entryAt('QUEUED', 1)], NOW)).toBe(5_000)
  })

  it('stops polling once a queued email is older than ten minutes, so a stuck row cannot keep the page polling', () => {
    expect(communicationRefetchInterval([entryAt('QUEUED', 11)], NOW)).toBe(false)
  })

  it('does not poll when nothing is queued, or there is no data yet', () => {
    expect(communicationRefetchInterval([entryAt('SENT', 1)], NOW)).toBe(false)
    expect(communicationRefetchInterval([], NOW)).toBe(false)
    expect(communicationRefetchInterval(undefined, NOW)).toBe(false)
  })
})
