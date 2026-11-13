import type { QueryKey } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
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

/** "Liste aktualisieren" for an offset list held by the scope client; busy from the click until the reload settles. */
export function ScopeRefreshNotice({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const [isRefreshing, setRefreshing] = useState(false)
  const refresh = () => {
    if (isRefreshing) return
    setRefreshing(true)
    void onRefresh()
      .catch(() => undefined)
      .finally(() => setRefreshing(false))
  }
  return (
    <div className="flex">
      <InfiniteListRefreshButton isRefreshing={isRefreshing} onRefresh={refresh} />
    </div>
  )
}

export function InfiniteListRefreshNotice({ queryKey }: { queryKey: QueryKey }) {
  const { needsRefresh, refreshExplicitly, isRefreshing } = useInfiniteListRefresh(queryKey)
  if (!needsRefresh) return null
  return (
    <InfiniteListRefreshButton
      isRefreshing={isRefreshing}
      onRefresh={() => void refreshExplicitly().catch(() => undefined)}
    />
  )
}
