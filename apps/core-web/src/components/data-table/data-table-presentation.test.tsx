import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { isDataTableFirstLoadActive, useDataTablePresentation } from './data-table-loading'

describe('isDataTableFirstLoadActive', () => {
  it('AUT-971: does not treat paused pending as first load', () => {
    expect(
      isDataTableFirstLoadActive({
        isLoading: true,
        isPending: true,
        isFetching: false,
        hasUsableData: false,
        listSnapshotResolved: false,
      }),
    ).toBe(false)
  })

  it('AUT-971: ends when list snapshot resolves while still pending (count/meta before rows)', () => {
    expect(
      isDataTableFirstLoadActive({
        isLoading: true,
        isPending: true,
        isFetching: true,
        hasUsableData: false,
        listSnapshotResolved: true,
      }),
    ).toBe(false)
  })
})

describe('useDataTablePresentation (AUT-971)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('WHEN listSnapshotResolved is set before skeleton delay THEN skeleton never arms', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useDataTablePresentation({
        isLoading: true,
        isPending: true,
        isFetching: true,
        isPlaceholderData: false,
        isError: false,
        hasUsableData: false,
        listSnapshotResolved: true,
        bypassSkeleton: false,
      }),
    )
    act(() => {
      vi.advanceTimersByTime(550)
    })
    expect(result.current.showFirstLoadSkeleton).toBe(false)
  })

  it('WHEN cached payload refetches THEN skeleton does not return', () => {
    const { result } = renderHook(() =>
      useDataTablePresentation({
        isLoading: false,
        isPending: false,
        isFetching: true,
        isPlaceholderData: false,
        isError: false,
        hasUsableData: true,
        listSnapshotResolved: true,
        bypassSkeleton: false,
      }),
    )
    expect(result.current.showFirstLoadSkeleton).toBe(false)
  })
})
