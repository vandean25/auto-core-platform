import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchWithAuth } from './client'
import {
  useCreateWorkshopEstimate,
  useRecordWorkshopEstimateDecision,
  useReviseWorkshopEstimate,
  useSendWorkshopEstimateVersion,
  workshopEstimateKeys,
} from './workshop-estimates'

vi.mock('./client', () => ({ fetchWithAuth: vi.fn() }))

const LIST_KEY = workshopEstimateKeys.list({ status: 'SENT' })

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  client.setQueryData(LIST_KEY, { pages: [], pageParams: [] })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  vi.mocked(fetchWithAuth).mockResolvedValue({ ok: true, json: async () => ({}) } as Response)
  return { client, wrapper }
}

describe('estimate mutations refresh the estimates lists', () => {
  afterEach(() => vi.clearAllMocks())

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
    const { client, wrapper } = setup()
    const { result } = renderHook(() => useHook(), { wrapper })
    expect(client.getQueryState(LIST_KEY)?.isInvalidated).toBe(false)

    await act(async () => {
      await (result.current.mutateAsync as (input: unknown) => Promise<unknown>)(variables)
    })

    expect(client.getQueryState(LIST_KEY)?.isInvalidated).toBe(true)
  })
})
