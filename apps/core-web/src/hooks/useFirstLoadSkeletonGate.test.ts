import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { INTERACTION_LOADING_TIMINGS } from '@/features/interaction/loading-timings'
import { useFirstLoadSkeletonGate } from './useFirstLoadSkeletonGate'

const { skeletonDelayMs } = INTERACTION_LOADING_TIMINGS

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

  it('AUT-971: does not re-arm after payloadReady even when first-load becomes active again', () => {
    const { result, rerender } = renderHook(
      ({ active, bypass, ready }) => useFirstLoadSkeletonGate(active, bypass, ready),
      { initialProps: { active: true, bypass: false, ready: false } },
    )

    act(() => vi.advanceTimersByTime(skeletonDelayMs))
    expect(result.current).toBe(true)
    rerender({ active: false, bypass: false, ready: true })
    act(() => vi.advanceTimersByTime(500))
    expect(result.current).toBe(false)
    rerender({ active: true, bypass: false, ready: true })
    act(() => vi.advanceTimersByTime(skeletonDelayMs))
    expect(result.current).toBe(false)
  })
})
