import type { QueryKey } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useInfiniteListRefresh } from '@/hooks/useInfiniteListRefresh'

type InfiniteListRefreshNoticeProps = {
  queryKey: QueryKey
}

/** ADR-0035 explicit refresh affordance after infinite-list settlement marks the query stale. */
export function InfiniteListRefreshNotice({ queryKey }: InfiniteListRefreshNoticeProps) {
  const { t } = useTranslation('common')
  const { needsRefresh, refresh, isRefreshing } = useInfiniteListRefresh(queryKey)

  if (!needsRefresh) return null

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="min-h-11"
      disabled={isRefreshing}
      onClick={() => {
        void refresh()
      }}
    >
      {t('dataTable.refreshList')}
    </Button>
  )
}
