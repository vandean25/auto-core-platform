import { describe, expect, it } from 'vitest'

import { offsetPaginatedQueryTableProps, showQuerySurfaceSkeleton } from './query-surface-loading'

describe('showQuerySurfaceSkeleton', () => {
  it.each([
    { isPending: true, isFetching: true, payload: undefined, expected: true },
    { isPending: true, isFetching: false, payload: undefined, expected: false },
    { isPending: false, isFetching: true, payload: { id: 1 }, expected: false },
    { isPending: true, isFetching: true, payload: { id: 1 }, expected: false },
  ])(
    'WHEN pending=$isPending fetching=$isFetching payload set=$payload THEN $expected',
    ({ isPending, isFetching, payload, expected }) => {
      expect(showQuerySurfaceSkeleton(isPending, payload, isFetching)).toBe(expected)
    },
  )
})

describe('offsetPaginatedQueryTableProps', () => {
  it('wires v5 active fetch and snapshot flags from query data', () => {
    const props = offsetPaginatedQueryTableProps({
      data: { data: [], meta: { pageCount: 2 } },
      isPending: false,
      isFetching: false,
      isPlaceholderData: false,
      isError: false,
    })
    expect(props.isLoading).toBe(false)
    expect(props.hasUsableData).toBe(true)
    expect(props.listSnapshotResolved).toBe(true)
  })
})
