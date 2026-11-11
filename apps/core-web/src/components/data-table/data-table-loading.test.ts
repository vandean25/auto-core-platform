import { describe, expect, it } from 'vitest'

import {
  isDataTableFirstLoadActive,
  isInfiniteListSnapshotResolved,
  isOffsetListSnapshotResolved,
  isListSnapshotResolved,
} from './data-table-loading'

describe('data-table loading snapshot helpers', () => {
  it('AUT-971: offset meta settled ends the skeleton gate without rows', () => {
    expect(isOffsetListSnapshotResolved(false, true)).toBe(true)
    expect(isOffsetListSnapshotResolved(false, false)).toBe(false)
  })

  it('AUT-971: first-load gate matches TanStack isLoading (pending && fetching)', () => {
    expect(
      isDataTableFirstLoadActive({
        isLoading: true,
        isPending: true,
        isFetching: true,
        hasUsableData: false,
        listSnapshotResolved: false,
      }),
    ).toBe(true)
    expect(
      isDataTableFirstLoadActive({
        isLoading: false,
        isPending: true,
        isFetching: false,
        hasUsableData: false,
        listSnapshotResolved: false,
      }),
    ).toBe(false)
  })

  it('combines infinite count and offset meta resolution', () => {
    expect(isListSnapshotResolved(false, { count: 3, isCapped: false }, false)).toBe(true)
    expect(isListSnapshotResolved(false, undefined, true)).toBe(true)
    expect(isListSnapshotResolved(false, undefined, false)).toBe(false)
    expect(isInfiniteListSnapshotResolved(true, undefined)).toBe(true)
  })
})
