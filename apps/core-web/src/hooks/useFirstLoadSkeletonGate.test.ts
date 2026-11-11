import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { INTERACTION_LOADING_TIMINGS } from '@/features/interaction/loading-timings'
import { skeletonMinVisibleHoldRemainingMs, useFirstLoadSkeletonGate } from './useFirstLoadSkeletonGate'

const { skeletonDelayMs, skeletonMinVisibleMs } = INTERACTION_LOADING_TIMINGS

describe('skeletonMinVisibleHoldRemainingMs', () => {
  it('returns the full minimum when the skeleton just became visible', () => {
    expect(skeletonMinVisibleHoldRemainingMs(1000, 1000)).toBe(skeletonMinVisibleMs)
  })

  it('returns zero when the minimum visible window has elapsed', () => {
    expect(skeletonMinVisibleHoldRemainingMs(1000, 1000 + skeletonMinVisibleMs)).toBe(0)
  })
})

describe('useFirstLoadSkeletonGate', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

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

  it('keeps minimum visible time after first load ends', () => {
    const { result, rerender } = renderHook(
      ({ active }) => useFirstLoadSkeletonGate(active, false),
      { initialProps: { active: true } },
    )

    act(() => vi.advanceTimersByTime(skeletonDelayMs))
    expect(result.current).toBe(true)

    rerender({ active: false })
    act(() => vi.advanceTimersByTime(skeletonMinVisibleMs - 1))
    expect(result.current).toBe(true)

    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe(false)
  })

  it('does not arm the skeleton when first load ends within the show delay', () => {
    const { result, rerender } = renderHook(
      ({ active }) => useFirstLoadSkeletonGate(active, false),
      { initialProps: { active: true } },
    )

    act(() => vi.advanceTimersByTime(skeletonDelayMs - 1))
    expect(result.current).toBe(false)

    rerender({ active: false })
    act(() => vi.advanceTimersByTime(10))
    expect(result.current).toBe(false)
  })
})
