import { describe, expect, it } from 'vitest'

import { offsetListTableProps } from './offset-list-table-props'

describe('offsetListTableProps', () => {
  it('AUT-971: resolves list snapshot when API meta is present', () => {
    const props = offsetListTableProps({
      data: { meta: { pageCount: 2 }, data: [] } as { meta: { pageCount: number }; data: unknown[] },
      isPending: false,
      isFetching: false,
      isPlaceholderData: false,
      isError: false,
    })

    expect(props.hasUsableData).toBe(true)
    expect(props.listSnapshotResolved).toBe(true)
    expect(props.isLoading).toBe(false)
  })

  it('AUT-971: maps TanStack isLoading to pending and actively fetching', () => {
    const paused = offsetListTableProps({
      data: undefined,
      isPending: true,
      isFetching: false,
      isPlaceholderData: false,
      isError: false,
    })
    expect(paused.isLoading).toBe(false)
    expect(paused.listSnapshotResolved).toBe(false)

    const loading = offsetListTableProps({
      data: undefined,
      isPending: true,
      isFetching: true,
      isPlaceholderData: false,
      isError: false,
    })
    expect(loading.isLoading).toBe(true)
  })
})
