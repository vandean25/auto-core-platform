import { isAwaitingFirstQueryPayload } from '@/features/interaction/query-first-load'
import { offsetListTableProps } from '@/components/data-table/offset-list-table-props'
import type { UseQueryResult } from '@tanstack/react-query'

type PagedMeta = { pageCount: number }

/** Whether a list/widget surface should show its first-load skeleton (AUT-971). */
export function showQuerySurfaceSkeleton(
  isPending: boolean,
  payload: unknown,
  isFetching: boolean,
): boolean {
  return isAwaitingFirstQueryPayload(isPending, payload !== undefined, isFetching)
}

/** DataTable loading props for an offset-paginated `useQuery` result. */
export function offsetPaginatedQueryTableProps<TData extends { meta: PagedMeta }>(
  query: Pick<UseQueryResult<TData>, 'data' | 'isPending' | 'isFetching' | 'isPlaceholderData' | 'isError'>,
) {
  return offsetListTableProps(query)
}
