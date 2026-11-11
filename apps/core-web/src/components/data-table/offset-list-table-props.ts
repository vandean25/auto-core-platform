import type { UseQueryResult } from '@tanstack/react-query'

import { isOffsetListSnapshotResolved } from './data-table-loading'

type PagedMeta = { pageCount: number }

/** Shared offset-list loading props for DataTable (AUT-971 paginated lists). */
export function offsetListTableProps<TData extends { meta: PagedMeta }>(
  query: Pick<UseQueryResult<TData>, 'data' | 'isPending' | 'isFetching' | 'isPlaceholderData' | 'isError'>,
) {
  const offsetMetaResolved = query.data !== undefined
  const hasUsableData = offsetMetaResolved
  return {
    pageCount: query.data?.meta.pageCount ?? 1,
    isLoading: query.isPending && query.isFetching,
    isPending: query.isPending,
    isFetching: query.isFetching,
    isPlaceholderData: query.isPlaceholderData,
    isError: query.isError,
    hasUsableData,
    listSnapshotResolved: isOffsetListSnapshotResolved(hasUsableData, offsetMetaResolved),
  }
}
