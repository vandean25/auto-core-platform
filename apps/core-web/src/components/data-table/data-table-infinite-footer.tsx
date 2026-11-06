import { useTranslation } from 'react-i18next'

import { InfiniteListRefreshButton } from '@/components/list/InfiniteListRefreshNotice'
import { Button } from '@/components/ui/button'
import { formatNumber } from '@/lib/format'
import { INFINITE_LIST_ROW_CAP } from '@/lib/infinite-list-query'
import { DataTableFetchError } from './data-table-states'
import type { DataTableInfiniteView } from './use-data-table-infinite'

type DataTableInfiniteFooterProps = {
  view: DataTableInfiniteView | undefined
  loadedCount: number
  /** A locked preview offers neither loading more nor retrying. */
  hidden: boolean
}

/** "Liste aktualisieren" once realtime, a mutation or an old cache marked the list stale. */
export function DataTableInfiniteRefresh({ view }: { view: DataTableInfiniteView | undefined }) {
  if (!view?.needsRefresh) return null
  return (
    <div className="flex">
      <InfiniteListRefreshButton isRefreshing={view.isRefreshing} onRefresh={view.refresh} />
    </div>
  )
}

/**
 * Below the rows of an infinite list: the keyboard-reachable "load more" button, the 2,000-row stop, the retry row
 * after a failed page, and one polite announcement of what happened (loading, end, limit, error).
 */
export function DataTableInfiniteFooter({ view, loadedCount, hidden }: DataTableInfiniteFooterProps) {
  const { t } = useTranslation('common')
  if (!view || hidden || loadedCount === 0) return null
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, capReached, canLoadMore, fetchNextPage } = view

  let announcement = ''
  if (isFetchNextPageError) announcement = t('dataTable.infinite.loadMoreFailed')
  else if (isFetchingNextPage) announcement = t('dataTable.infinite.loadingMore')
  else if (!hasNextPage && loadedCount > 0) announcement = t('dataTable.infinite.endReached', { count: loadedCount })

  return (
    <div className="space-y-2">
      <p role="status" aria-live="polite" className="sr-only" data-testid="data-table-announcement">
        {announcement}
      </p>
      {isFetchNextPageError ? (
        <DataTableFetchError message={t('dataTable.infinite.loadMoreFailed')} onRetry={() => void fetchNextPage()} />
      ) : null}
      {capReached && hasNextPage ? (
        <p role="status" className="py-2 text-center text-sm text-muted-foreground">
          {t('dataTable.infinite.capReached', { max: formatNumber(INFINITE_LIST_ROW_CAP) })}
        </p>
      ) : null}
      {canLoadMore && !isFetchNextPageError ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={isFetchingNextPage}
            aria-busy={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            {t('dataTable.infinite.loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
