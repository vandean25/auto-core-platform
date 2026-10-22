import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDelayedFlag } from './useDelayedFlag'

describe('useDelayedFlag', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('stays false until the flag has been true for the delay', () => {
    const { result } = renderHook(() => useDelayedFlag(true, 200))

    expect(result.current).toBe(false)
    act(() => vi.advanceTimersByTime(199))
    expect(result.current).toBe(false)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe(true)
  })

  it('never turns true when the flag clears before the delay (no flicker)', () => {
    const { result, rerender } = renderHook(({ flag }) => useDelayedFlag(flag, 200), { initialProps: { flag: true } })

    act(() => vi.advanceTimersByTime(100))
    rerender({ flag: false })
    act(() => vi.advanceTimersByTime(500))

    expect(result.current).toBe(false)
  })

  it('turns false immediately when the flag clears after the delay', () => {
    const { result, rerender } = renderHook(({ flag }) => useDelayedFlag(flag, 200), { initialProps: { flag: true } })

    act(() => vi.advanceTimersByTime(200))
    expect(result.current).toBe(true)
    rerender({ flag: false })

    expect(result.current).toBe(false)
  })
})
