import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_CONCURRENT_PREFETCHES,
  MAX_RETAINED_DETAIL_ENTRIES,
  resetIntentPrefetchScheduler,
  scheduleDetailPrefetch,
} from './intent-prefetch'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('intent-prefetch scheduler', () => {
  beforeEach(() => {
    resetIntentPrefetchScheduler()
  })

  afterEach(() => {
    resetIntentPrefetchScheduler()
    vi.useRealTimers()
  })

  it('bounds concurrent prefetches and drains queued entries as in-flight requests finish', async () => {
    vi.useFakeTimers()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const prefetchSpy = vi.spyOn(queryClient, 'prefetchQuery')

    const blockers = Array.from({ length: MAX_CONCURRENT_PREFETCHES }, () =>
      deferred<{ id: string }>(),
    )
    for (let index = 0; index < MAX_CONCURRENT_PREFETCHES + 1; index += 1) {
      const blocker = blockers[index]
      scheduleDetailPrefetch(queryClient, {
        queryKey: ['vehicles', 'detail', `concurrent-${index}`],
        queryFn: () =>
          blocker ? blocker.promise : Promise.resolve({ id: `concurrent-${index}` }),
      })
    }

    vi.advanceTimersByTime(100)
    expect(prefetchSpy).toHaveBeenCalledTimes(MAX_CONCURRENT_PREFETCHES)

    for (const blocker of blockers) {
      blocker.resolve({ id: 'done' })
    }
    for (let tick = 0; tick < 10; tick += 1) {
      await Promise.resolve()
    }

    expect(prefetchSpy).toHaveBeenCalledTimes(MAX_CONCURRENT_PREFETCHES + 1)
    expect(prefetchSpy.mock.calls[MAX_CONCURRENT_PREFETCHES]?.[0]).toMatchObject({
      queryKey: ['vehicles', 'detail', `concurrent-${MAX_CONCURRENT_PREFETCHES}`],
    })
  })

  it('evicts the oldest inactive speculative detail entries beyond MAX_RETAINED_DETAIL_ENTRIES', async () => {
    vi.useFakeTimers()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    for (let index = 0; index < MAX_RETAINED_DETAIL_ENTRIES + 3; index += 1) {
      scheduleDetailPrefetch(queryClient, {
        queryKey: ['customers', 'detail', `retained-${index}`],
        queryFn: async () => ({ id: `retained-${index}` }),
      })
      vi.advanceTimersByTime(100)
      for (let tick = 0; tick < 10; tick += 1) {
        await Promise.resolve()
      }
    }

    expect(queryClient.getQueryData(['customers', 'detail', 'retained-0'])).toBeUndefined()
    expect(queryClient.getQueryData(['customers', 'detail', 'retained-1'])).toBeUndefined()
    expect(queryClient.getQueryData(['customers', 'detail', 'retained-2'])).toBeUndefined()
    expect(
      queryClient.getQueryData([
        'customers',
        'detail',
        `retained-${MAX_RETAINED_DETAIL_ENTRIES + 2}`,
      ]),
    ).toEqual({ id: `retained-${MAX_RETAINED_DETAIL_ENTRIES + 2}` })
  })

  it('silently swallows rejected prefetch queries and frees concurrency slots', async () => {
    vi.useFakeTimers()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const prefetchSpy = vi
      .spyOn(queryClient, 'prefetchQuery')
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(undefined)

    scheduleDetailPrefetch(
      queryClient,
      {
        queryKey: ['invoices', 'detail', 'inv-fail'],
        queryFn: async () => ({ id: 'inv-fail' }),
      },
      { immediate: true },
    )
    for (let tick = 0; tick < 5; tick += 1) {
      await Promise.resolve()
    }

    scheduleDetailPrefetch(
      queryClient,
      {
        queryKey: ['invoices', 'detail', 'inv-ok'],
        queryFn: async () => ({ id: 'inv-ok' }),
      },
      { immediate: true },
    )
    for (let tick = 0; tick < 5; tick += 1) {
      await Promise.resolve()
    }

    expect(prefetchSpy).toHaveBeenCalledTimes(2)
    expect(prefetchSpy.mock.calls[1]?.[0]).toMatchObject({
      queryKey: ['invoices', 'detail', 'inv-ok'],
    })
  })
})
