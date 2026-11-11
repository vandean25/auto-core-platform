import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { INTERACTION_LOADING_TIMINGS } from '@/features/interaction/loading-timings'
import { useFirstLoadSkeletonGate } from './useFirstLoadSkeletonGate'

const { skeletonDelayMs, skeletonMinVisibleMs } = INTERACTION_LOADING_TIMINGS

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

  it('AUT-971: clears immediately when the load ends and payload is settled', () => {
    const { result, rerender } = renderHook(
      ({ active, payloadSettled }) => useFirstLoadSkeletonGate(active, false, payloadSettled),
      { initialProps: { active: true, payloadSettled: false } },
    )

    act(() => vi.advanceTimersByTime(skeletonDelayMs))
    expect(result.current).toBe(true)

    rerender({ active: false, payloadSettled: true })
    expect(result.current).toBe(false)
  })

  it('keeps minimum visible time when load ends before payload is settled', () => {
    const { result, rerender } = renderHook(
      ({ active, payloadSettled }) => useFirstLoadSkeletonGate(active, false, payloadSettled),
      { initialProps: { active: true, payloadSettled: false } },
    )

    act(() => vi.advanceTimersByTime(skeletonDelayMs))
    expect(result.current).toBe(true)

    rerender({ active: false, payloadSettled: false })
    act(() => vi.advanceTimersByTime(50))
    expect(result.current).toBe(true)

    act(() => vi.advanceTimersByTime(skeletonMinVisibleMs))
    expect(result.current).toBe(false)
  })
})
