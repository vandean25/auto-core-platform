import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { offsetListTableProps } from '@/components/data-table/offset-list-table-props'
import { isDataTableFirstLoadActive, useDataTablePresentation } from '@/components/data-table/data-table-loading'
import { INTERACTION_LOADING_TIMINGS } from '@/features/interaction/loading-timings'

/** Pre-AUT-971 `useDataTablePresentation` first-load flag. */
function legacyTableFirstLoadActive(isLoading: boolean, hasUsableData: boolean, listSnapshotResolved: boolean) {
  return isLoading && !hasUsableData && !listSnapshotResolved
}

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('AUT-971 query surfaces (real TanStack Query)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('WHEN list payload is settled but a sibling count query is still fetching THEN skeleton stays off (legacy branch stuck without snapshot flags)', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const listPayload = { data: [{ id: 'v1' }], meta: { pageCount: 1 } }
    const countDeferred = createDeferred<{ count: number }>()

    const { result: listResult } = renderHook(
      () =>
        useQuery({
          queryKey: ['aut-971', 'list'],
          queryFn: async () => listPayload,
        }),
      { wrapper: wrapper(queryClient) },
    )

    const { result: countResult } = renderHook(
      () =>
        useQuery({
          queryKey: ['aut-971', 'count'],
          queryFn: () => countDeferred.promise,
        }),
      { wrapper: wrapper(queryClient) },
    )

    await waitFor(() => expect(listResult.current.data).toBeDefined())
    await waitFor(() => expect(countResult.current.isFetching).toBe(true))

    const wired = offsetListTableProps({
      data: listResult.current.data,
      isPending: listResult.current.isPending,
      isFetching: listResult.current.isFetching,
      isPlaceholderData: listResult.current.isPlaceholderData,
      isError: listResult.current.isError,
    })

    const miswiredLoading = countResult.current.isPending && countResult.current.isFetching
    expect(miswiredLoading).toBe(true)

    expect(
      isDataTableFirstLoadActive({
        isLoading: miswiredLoading,
        isPending: countResult.current.isPending,
        isFetching: countResult.current.isFetching,
        hasUsableData: wired.hasUsableData,
        listSnapshotResolved: wired.listSnapshotResolved,
      }),
    ).toBe(false)

    expect(
      legacyTableFirstLoadActive(miswiredLoading, wired.hasUsableData, wired.listSnapshotResolved),
    ).toBe(false)

    // Pre-fix: list GET stored but snapshot flags missing while a sibling kept `isLoading` true.
    expect(
      isDataTableFirstLoadActive({
        isLoading: miswiredLoading,
        isPending: countResult.current.isPending,
        isFetching: countResult.current.isFetching,
        hasUsableData: false,
        listSnapshotResolved: false,
      }),
    ).toBe(true)
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

  it('WHEN useQuery resolves THEN offset props and presentation skeleton clear within 350ms', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result: queryResult } = renderHook(
      () =>
        useQuery({
          queryKey: ['aut-971', 'offset-resolve'],
          queryFn: async () => ({ data: [{ id: 'v1' }], meta: { pageCount: 1 } }),
        }),
      { wrapper: wrapper(queryClient) },
    )

    await waitFor(() => expect(queryResult.current.data).toBeDefined())
    const wiredSettled = offsetListTableProps({
      data: queryResult.current.data,
      isPending: queryResult.current.isPending,
      isFetching: queryResult.current.isFetching,
      isPlaceholderData: queryResult.current.isPlaceholderData,
      isError: queryResult.current.isError,
    })

    vi.useFakeTimers()
    const { result: presentationResult, rerender } = renderHook(
      ({ tableProps }: { tableProps: ReturnType<typeof offsetListTableProps> }) =>
        useDataTablePresentation({
          isLoading: tableProps.isLoading,
          isPending: tableProps.isPending,
          isFetching: tableProps.isFetching,
          isPlaceholderData: tableProps.isPlaceholderData,
          isError: tableProps.isError,
          hasUsableData: tableProps.hasUsableData,
          listSnapshotResolved: tableProps.listSnapshotResolved,
          bypassSkeleton: false,
        }),
      {
        initialProps: {
          tableProps: offsetListTableProps({
            data: undefined,
            isPending: true,
            isFetching: true,
            isPlaceholderData: false,
            isError: false,
          }),
        },
      },
    )

    act(() => {
      vi.advanceTimersByTime(INTERACTION_LOADING_TIMINGS.skeletonDelayMs + 50)
    })
    expect(presentationResult.current.showFirstLoadSkeleton).toBe(true)

    rerender({ tableProps: wiredSettled })

    act(() => {
      vi.advanceTimersByTime(INTERACTION_LOADING_TIMINGS.skeletonMinVisibleMs)
    })
    expect(presentationResult.current.showFirstLoadSkeleton).toBe(false)
  })
})
