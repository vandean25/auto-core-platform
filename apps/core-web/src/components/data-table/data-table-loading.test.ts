import { describe, expect, it } from 'vitest'

import { isInfiniteListSnapshotResolved, isOffsetListSnapshotResolved, isListSnapshotResolved } from './data-table-loading'

describe('data-table loading snapshot helpers', () => {
  it('AUT-971: offset meta settled ends the skeleton gate without rows', () => {
    expect(isOffsetListSnapshotResolved(false, true)).toBe(true)
    expect(isOffsetListSnapshotResolved(false, false)).toBe(false)
  })

  it('combines infinite count and offset meta resolution', () => {
    expect(isListSnapshotResolved(false, { count: 3, isCapped: false }, false)).toBe(true)
    expect(isListSnapshotResolved(false, undefined, true)).toBe(true)
    expect(isListSnapshotResolved(false, undefined, false)).toBe(false)
    expect(isInfiniteListSnapshotResolved(true, undefined)).toBe(true)
  })
})
