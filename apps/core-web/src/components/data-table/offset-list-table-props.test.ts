import type { UseQueryResult } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import { offsetListTableProps } from './offset-list-table-props'

const noopRefetch = vi.fn(async () => ({ data: undefined })) as UseQueryResult<{ meta: { pageCount: number } }>['refetch']

describe('offsetListTableProps', () => {
  it('AUT-971: resolves list snapshot when API meta is present', () => {
    const props = offsetListTableProps({
      data: { meta: { pageCount: 2 }, data: [] } as { meta: { pageCount: number }; data: unknown[] },
      isPending: false,
      isFetching: false,
      isPlaceholderData: false,
      isError: false,
      refetch: noopRefetch,
    })

    expect(props.hasUsableData).toBe(true)
    expect(props.listSnapshotResolved).toBe(true)
    expect(props.isLoading).toBe(false)
  })

  it('AUT-971: resolves list snapshot when the query is no longer pending', () => {
    const props = offsetListTableProps({
      data: undefined,
      isPending: false,
      isFetching: false,
      isPlaceholderData: false,
      isError: true,
      refetch: noopRefetch,
    })
    expect(props.listSnapshotResolved).toBe(true)
    expect(props.hasUsableData).toBe(false)
  })

  it('AUT-971: maps TanStack isLoading to pending and actively fetching', () => {
    const paused = offsetListTableProps({
      data: undefined,
      isPending: true,
      isFetching: false,
      isPlaceholderData: false,
      isError: false,
      refetch: noopRefetch,
    })
    expect(paused.isLoading).toBe(false)
    expect(paused.listSnapshotResolved).toBe(false)

    const loading = offsetListTableProps({
      data: undefined,
      isPending: true,
      isFetching: true,
      isPlaceholderData: false,
      isError: false,
      refetch: noopRefetch,
    })
    expect(loading.isLoading).toBe(true)
  })

  it('AUT-971: wires onRetry when the offset query failed without data', () => {
    const refetch = vi.fn(async () => ({ data: undefined }))
    const props = offsetListTableProps({
      data: undefined,
      isPending: false,
      isFetching: false,
      isPlaceholderData: false,
      isError: true,
      refetch: refetch as UseQueryResult<{ meta: { pageCount: number } }>['refetch'],
    })
    expect(props.onRetry).toBeTypeOf('function')
    props.onRetry()
    expect(refetch).toHaveBeenCalledTimes(1)
  })
})
