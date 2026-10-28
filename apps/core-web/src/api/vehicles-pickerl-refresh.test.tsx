import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWithAuth } from './client'
import { usePickerlDueList } from './vehicles'

vi.mock('./client', () => ({ fetchWithAuth: vi.fn() }))

const fetchMock = vi.mocked(fetchWithAuth)

function wrapperFor(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

/** The user leaves the tab and comes back: what the browser reports as losing and regaining focus. */
function refocus() {
  focusManager.setFocused(false)
  focusManager.setFocused(true)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-28T10:00:00.000Z'))
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ data: [], meta: { total: 0 } })))
})

afterEach(() => {
  vi.useRealTimers()
  fetchMock.mockReset()
})

describe('Pickerl due list refresh (AUT-807)', () => {
  async function mountAndLoad() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = renderHook(() => usePickerlDueList({ window: 30, page: 1, pageSize: 25 }), {
      wrapper: wrapperFor(queryClient),
    })
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    return view
  }

  it('does not refetch when the tab is shown again on the same day, even if the data is stale', async () => {
    await mountAndLoad()

    vi.setSystemTime(new Date('2026-10-28T20:00:00.000Z'))
    refocus()

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refetches when the tab is shown again after the day changed, without any vehicle write', async () => {
    await mountAndLoad()

    vi.setSystemTime(new Date('2026-10-29T00:05:00.000Z'))
    refocus()

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('refetches across a month boundary', async () => {
    vi.setSystemTime(new Date('2026-10-31T23:59:30.000Z'))
    await mountAndLoad()

    vi.setSystemTime(new Date('2026-11-01T00:00:10.000Z'))
    refocus()

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })
})
