import type { UseQueryResult } from '@tanstack/react-query'

type PagedMeta = { pageCount: number }

/** Offset-list DataTable props: pager meta from the query plus `onRetry` for failed first loads (AUT-971). */
export function offsetListTableProps<TData extends { meta: PagedMeta }>(
  query: Pick<UseQueryResult<TData>, 'data' | 'refetch'>,
) {
  return {
    pageCount: query.data?.meta.pageCount ?? 0,
    onRetry: () => void query.refetch(),
  }
}
