import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { isDataTableFirstLoadActive } from './data-table-loading'

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
})
