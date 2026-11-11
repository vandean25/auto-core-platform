import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { offsetListTableProps } from './offset-list-table-props'
import { isDataTableFirstLoadActive } from './data-table-loading'

function legacyTableFirstLoadActive(isLoading: boolean, hasUsableData: boolean, listSnapshotResolved: boolean) {
  return isLoading && !hasUsableData && !listSnapshotResolved
}

function queryClientWrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('AUT-971 TanStack Query v5 first-load gate', () => {
  it('WHEN the query settles THEN isLoading and the DataTable gate turn off together', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { promise, resolve } = createDeferred<{ rows: string[] }>()

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['aut-971', 'list'],
          queryFn: () => promise,
        }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      },
    )

    await waitFor(() => expect(result.current.isFetching).toBe(true))
    expect(result.current.isLoading).toBe(true)
    expect(
      isDataTableFirstLoadActive({
        isPending: result.current.isPending,
        isFetching: result.current.isFetching,
        isLoading: result.current.isLoading,
        hasUsableData: result.current.data !== undefined,
        listSnapshotResolved: false,
      }),
    ).toBe(true)

    resolve({ rows: ['row-1'] })
    await waitFor(() => expect(result.current.isPending).toBe(false))

    expect(result.current.isLoading).toBe(false)
    expect(
      isDataTableFirstLoadActive({
        isPending: result.current.isPending,
        isFetching: result.current.isFetching,
        isLoading: result.current.isLoading,
        hasUsableData: result.current.data !== undefined,
        listSnapshotResolved: false,
      }),
    ).toBe(false)
  })

  it('WHEN query is v5-shaped at settle THEN legacy and modern first-load gates agree', () => {
    const inputs = {
      isLoading: false,
      isPending: false,
      isFetching: false,
      hasUsableData: true,
      listSnapshotResolved: true,
    }
    expect(legacyTableFirstLoadActive(inputs.isLoading, inputs.hasUsableData, inputs.listSnapshotResolved)).toBe(false)
    expect(isDataTableFirstLoadActive(inputs)).toBe(false)
  })

  it('WHEN isPending is wired as isLoading without isFetching THEN paused pending kept the legacy gate active', () => {
    const legacyGateActive = (isLoading: boolean, hasUsableData: boolean) => isLoading && !hasUsableData
    const pausedPending = {
      isPending: true,
      isFetching: false,
      isLoading: true,
      hasUsableData: false,
      listSnapshotResolved: false,
    }

    expect(legacyGateActive(pausedPending.isLoading, pausedPending.hasUsableData)).toBe(true)
    expect(isDataTableFirstLoadActive(pausedPending)).toBe(false)
  })

  it('WHEN list payload is settled but a sibling count fetch is active THEN snapshot flags end first load (legacy stuck without them)', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { promise: countPromise } = createDeferred<{ count: number }>()
    const listPayload = { data: [{ id: 'v1' }], meta: { pageCount: 1 } }

    const { result: listResult } = renderHook(
      () =>
        useQuery({
          queryKey: ['aut-971', 'list-sibling'],
          queryFn: async () => listPayload,
        }),
      { wrapper: queryClientWrapper(queryClient) },
    )
    const { result: countResult } = renderHook(
      () =>
        useQuery({
          queryKey: ['aut-971', 'count-sibling'],
          queryFn: () => countPromise,
        }),
      { wrapper: queryClientWrapper(queryClient) },
    )

    await waitFor(() => expect(listResult.current.data).toBeDefined())
    await waitFor(() => expect(countResult.current.isFetching).toBe(true))

    const wired = offsetListTableProps({
      data: listResult.current.data,
      isPending: listResult.current.isPending,
      isFetching: listResult.current.isFetching,
      isPlaceholderData: listResult.current.isPlaceholderData,
      isError: listResult.current.isError,
      refetch: listResult.current.refetch,
    })
    const miswiredLoading = countResult.current.isPending && countResult.current.isFetching
    expect(
      isDataTableFirstLoadActive({
        isLoading: miswiredLoading,
        isPending: countResult.current.isPending,
        isFetching: countResult.current.isFetching,
        hasUsableData: wired.hasUsableData,
        listSnapshotResolved: wired.listSnapshotResolved,
      }),
    ).toBe(false)
    expect(legacyTableFirstLoadActive(miswiredLoading, wired.hasUsableData, wired.listSnapshotResolved)).toBe(false)
    expect(legacyTableFirstLoadActive(miswiredLoading, false, false)).toBe(true)
    expect(
      isDataTableFirstLoadActive({
        isLoading: miswiredLoading,
        isPending: countResult.current.isPending,
        isFetching: countResult.current.isFetching,
        hasUsableData: false,
        listSnapshotResolved: true,
      }),
    ).toBe(false)
  })
})
