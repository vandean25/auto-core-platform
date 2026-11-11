import type { UseQueryResult } from '@tanstack/react-query'

type PagedMeta = { pageCount: number }

/** Shared offset-list loading props for DataTable (AUT-971 paginated lists). */
export function offsetListTableProps<TData extends { meta: PagedMeta }>(
  query: Pick<UseQueryResult<TData>, 'data' | 'isPending' | 'isFetching' | 'isPlaceholderData' | 'isError'>,
) {
  const settled = query.data !== undefined
  return {
    pageCount: query.data?.meta.pageCount ?? 1,
    isLoading: query.isPending,
    isPending: query.isPending,
    isFetching: query.isFetching,
    isPlaceholderData: query.isPlaceholderData,
    isError: query.isError,
    hasUsableData: settled,
    listSnapshotResolved: settled,
  }
}
