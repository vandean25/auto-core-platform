import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { offsetListTableProps } from '@/components/data-table/offset-list-table-props'
import { isDataTableFirstLoadActive, useDataTablePresentation } from '@/components/data-table/data-table-loading'
import { INTERACTION_LOADING_TIMINGS } from '@/features/interaction/loading-timings'

/** Pre-AUT-971: list pages passed `isPending` as the DataTable `isLoading` prop. */
function legacyMiswiredListFirstLoadActive(isPending: boolean, hasUsableData: boolean, listSnapshotResolved: boolean) {
  return isPending && !hasUsableData && !listSnapshotResolved
}

/** Pre-AUT-971 dashboard widgets branched on `isLoading` from the hook. */
function legacyWidgetSkeletonVisible(isLoading: boolean) {
  return isLoading
}

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

/** v5 paused pending (no payload, not fetching) — offline tabs and cancelled fetches emit this shape. */
const PAUSED_V5_LIST_QUERY = {
  data: undefined,
  isPending: true,
  isFetching: false,
  isPlaceholderData: false,
  isError: false,
} as const

describe('AUT-971 query surfaces (real TanStack Query)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('WHEN a list query is paused pending (v5) THEN legacy miswire keeps first-load active but offsetListTableProps does not', () => {
    const wired = offsetListTableProps(PAUSED_V5_LIST_QUERY)

    expect(wired.isLoading).toBe(false)
    expect(legacyMiswiredListFirstLoadActive(PAUSED_V5_LIST_QUERY.isPending, wired.hasUsableData, wired.listSnapshotResolved)).toBe(
      true,
    )
    expect(
      isDataTableFirstLoadActive({
        isLoading: wired.isLoading,
        isPending: wired.isPending,
        isFetching: wired.isFetching,
        hasUsableData: wired.hasUsableData,
        listSnapshotResolved: wired.listSnapshotResolved,
      }),
    ).toBe(false)

    // Pre-fix list pages passed `isPending` as `isLoading` and omitted `isFetching`, so paused pending looked “active”.
    expect(
      isDataTableFirstLoadActive({
        isLoading: PAUSED_V5_LIST_QUERY.isPending,
        isPending: PAUSED_V5_LIST_QUERY.isPending,
        hasUsableData: wired.hasUsableData,
        listSnapshotResolved: wired.listSnapshotResolved,
      }),
    ).toBe(true)
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

    expect(
      legacyMiswiredListFirstLoadActive(
        queryResult.current.isPending,
        wiredSettled.hasUsableData,
        wiredSettled.listSnapshotResolved,
      ),
    ).toBe(false)
    expect(legacyWidgetSkeletonVisible(queryResult.current.isLoading)).toBe(false)

    act(() => {
      vi.advanceTimersByTime(INTERACTION_LOADING_TIMINGS.skeletonMinVisibleMs)
    })
    expect(presentationResult.current.showFirstLoadSkeleton).toBe(false)
  })
})
