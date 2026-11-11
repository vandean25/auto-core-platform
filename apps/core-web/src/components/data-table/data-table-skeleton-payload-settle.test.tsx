import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { INTERACTION_LOADING_TIMINGS } from '@/features/interaction/loading-timings'
import { skeletonMinVisibleHoldRemainingMs } from '@/hooks/useFirstLoadSkeletonGate'
import { useDataTablePresentation } from './data-table-loading'

const { skeletonDelayMs, skeletonMinVisibleMs } = INTERACTION_LOADING_TIMINGS

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('AUT-971 skeleton dismiss after list payload (vehicles)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('v5 useQuery on a vehicle-shaped list payload settles with isLoading false', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { promise, resolve } = createDeferred<{ data: { id: string }[]; meta: { pageCount: number } }>()

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['aut-971', 'vehicles-v5'],
          queryFn: () => promise,
        }),
      {
        wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
      },
    )

    await waitFor(() => expect(result.current.isFetching).toBe(true))
    expect(result.current.isLoading).toBe(true)

    resolve({ data: [{ id: 'v1' }], meta: { pageCount: 1 } })
    await waitFor(() => expect(result.current.isPending).toBe(false))
    expect(result.current.isLoading).toBe(false)
    expect(result.current.data).toBeDefined()
  })

  it('ADR-0036: post-payload gap is only the remaining minimum-visible hold (not an extra timer tick)', () => {
    vi.useFakeTimers()
    const visibleSince = skeletonDelayMs
    const dataArrivedAt = skeletonDelayMs + 50
    const holdAfterPayload = skeletonMinVisibleHoldRemainingMs(visibleSince, dataArrivedAt)
    expect(holdAfterPayload).toBe(skeletonMinVisibleMs - 50)

    const { result, rerender } = renderHook((props: Parameters<typeof useDataTablePresentation>[0]) => useDataTablePresentation(props), {
      initialProps: {
        isLoading: true,
        isFetching: true,
        isPlaceholderData: false,
        isError: false,
        hasUsableData: false,
        listSnapshotResolved: false,
        bypassSkeleton: false,
      },
    })

    act(() => {
      vi.advanceTimersByTime(skeletonDelayMs)
    })
    expect(result.current.showFirstLoadSkeleton).toBe(true)

    act(() => {
      vi.advanceTimersByTime(50)
    })
    rerender({
      isLoading: false,
      isFetching: false,
      isPlaceholderData: false,
      isError: false,
      hasUsableData: true,
      listSnapshotResolved: true,
      bypassSkeleton: false,
    })

    act(() => {
      vi.advanceTimersByTime(holdAfterPayload - 1)
    })
    expect(result.current.showFirstLoadSkeleton).toBe(true)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.showFirstLoadSkeleton).toBe(false)
  })
})
