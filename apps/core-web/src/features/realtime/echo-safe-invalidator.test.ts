import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEchoSafeInvalidator } from './echo-safe-invalidator'
import { getRealtimeInvalidationWindowMs } from './dashboard-entity-map'
import { dashboardWidgetKeys } from '@/features/dashboard-widgets/dashboard-widget-keys'

const key = ['customers'] as const

function setup(windowMs = 1_000) {
  const queryClient = new QueryClient()
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined)
  const invalidator = createEchoSafeInvalidator(queryClient, { windowMs: () => windowMs })
  return { queryClient, invalidate, invalidator }
}

describe('createEchoSafeInvalidator coalescing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('turns a burst of events into one refetch now and one when the window ends, never one per event', () => {
    const { invalidate, invalidator } = setup()

    for (let event = 0; event < 500; event += 1) invalidator.invalidate(key)
    expect(invalidate).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(999)
    expect(invalidate).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(invalidate).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(10_000)
    expect(invalidate).toHaveBeenCalledTimes(2)
  })

  it('keeps a long burst to one refetch per window', () => {
    const { invalidate, invalidator } = setup()

    // An import: an event every 10 ms for 5 s.
    for (let elapsed = 0; elapsed < 5_000; elapsed += 10) {
      invalidator.invalidate(key)
      vi.advanceTimersByTime(10)
    }
    vi.advanceTimersByTime(1_000)

    expect(invalidate.mock.calls.length).toBeLessThanOrEqual(6)
    expect(invalidate.mock.calls.length).toBeGreaterThanOrEqual(5)
  })

  it('refetches a lone event at once and keeps different keys apart', () => {
    const { invalidate, invalidator } = setup()

    invalidator.invalidate(key)
    invalidator.invalidate(['vehicles'])

    expect(invalidate).toHaveBeenCalledTimes(2)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: key, refetchType: 'active' })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['vehicles'], refetchType: 'active' })
  })

  it('runs an event after the window without waiting', () => {
    const { invalidate, invalidator } = setup()

    invalidator.invalidate(key)
    vi.advanceTimersByTime(1_500)
    invalidator.invalidate(key)

    expect(invalidate).toHaveBeenCalledTimes(2)
  })

  it('does not coalesce without a window', () => {
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined)
    const invalidator = createEchoSafeInvalidator(queryClient)

    invalidator.invalidate(key)
    invalidator.invalidate(key)

    expect(invalidate).toHaveBeenCalledTimes(2)
  })

  it('flushes an event that waits for its window when it is disposed, so nothing is lost', () => {
    const { invalidate, invalidator } = setup()

    invalidator.invalidate(key)
    invalidator.invalidate(key)
    expect(invalidate).toHaveBeenCalledTimes(1)

    invalidator.dispose()
    expect(invalidate).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(10_000)
    expect(invalidate).toHaveBeenCalledTimes(2)
  })

  it('still defers an event while a mutation of that key is pending, then coalesces it', async () => {
    const { queryClient, invalidate, invalidator } = setup()
    let finish!: () => void
    void queryClient
      .getMutationCache()
      .build(queryClient, {
        mutationKey: key,
        mutationFn: () => new Promise<void>((resolve) => (finish = resolve)),
      })
      .execute(undefined)
    await vi.advanceTimersByTimeAsync(0)

    invalidator.invalidate(key)
    invalidator.invalidate(key)
    expect(invalidate).not.toHaveBeenCalled()

    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(invalidate).toHaveBeenCalledTimes(1)
  })
})

describe('realtime invalidation windows', () => {
  it('gives the dashboard widgets, which refetch whole row lists, a longer window than the domain queries', () => {
    expect(getRealtimeInvalidationWindowMs(dashboardWidgetKeys.source('customers'))).toBe(10_000)
    expect(getRealtimeInvalidationWindowMs(['customers'])).toBe(2_000)
  })
})
