import type { QueryKey } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { handshakeBeforeExplicitListRefresh } from '@/auth/scope-context-client'
import { useInfiniteListRefresh } from '@/hooks/useInfiniteListRefresh'

type InfiniteListRefreshButtonProps = {
  isRefreshing: boolean
  onRefresh: () => void
}

/** ADR-0035 explicit refresh affordance after infinite-list settlement marks the query stale. */
export function InfiniteListRefreshButton({ isRefreshing, onRefresh }: InfiniteListRefreshButtonProps) {
  const { t } = useTranslation('common')
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="min-h-11"
      disabled={isRefreshing}
      onClick={onRefresh}
    >
      {t('dataTable.refreshList')}
    </Button>
  )
}

export function InfiniteListRefreshNotice({ queryKey }: { queryKey: QueryKey }) {
  const { needsRefresh, refresh, isRefreshing } = useInfiniteListRefresh(queryKey)
  if (!needsRefresh) return null
  return (
    <InfiniteListRefreshButton
      isRefreshing={isRefreshing}
      onRefresh={() => {
        void (async () => {
          const ready = await handshakeBeforeExplicitListRefresh()
          if (!ready) return
          await refresh().catch(() => undefined)
        })()
      }}
    />
  )
}
