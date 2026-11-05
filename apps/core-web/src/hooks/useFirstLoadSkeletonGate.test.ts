import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { INTERACTION_LOADING_TIMINGS } from '@/features/interaction/loading-timings'
import { useFirstLoadSkeletonGate } from './useFirstLoadSkeletonGate'

const { skeletonDelayMs, skeletonMinVisibleMs } = INTERACTION_LOADING_TIMINGS

describe('useFirstLoadSkeletonGate', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('WHEN first-load data arrives before 200 ms THEN no skeleton is shown', () => {
    const { result, rerender } = renderHook(
      ({ active }) => useFirstLoadSkeletonGate(active),
      { initialProps: { active: true } },
    )

    act(() => vi.advanceTimersByTime(skeletonDelayMs - 1))
    expect(result.current).toBe(false)
    rerender({ active: false })
    act(() => vi.advanceTimersByTime(skeletonMinVisibleMs))
    expect(result.current).toBe(false)
  })

  it('WHEN a skeleton has appeared THEN it stays at least 350 ms unless bypassed', () => {
    const { result, rerender } = renderHook(
      ({ active, bypass }) => useFirstLoadSkeletonGate(active, bypass),
      { initialProps: { active: true, bypass: false } },
    )

    act(() => vi.advanceTimersByTime(skeletonDelayMs))
    expect(result.current).toBe(true)

    rerender({ active: false, bypass: false })
    act(() => vi.advanceTimersByTime(skeletonMinVisibleMs - 1))
    expect(result.current).toBe(true)

    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe(false)
  })

  it('clears immediately when bypass is set after the skeleton appeared', () => {
    const { result, rerender } = renderHook(
      ({ active, bypass }) => useFirstLoadSkeletonGate(active, bypass),
      { initialProps: { active: true, bypass: false } },
    )

    act(() => vi.advanceTimersByTime(skeletonDelayMs))
    expect(result.current).toBe(true)
    rerender({ active: true, bypass: true })
    expect(result.current).toBe(false)
  })
})
