import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { getErrorMessage } from '@/lib/error-utils'

export function EstimateListLoadError({ error }: { error: unknown }) {
  const { t } = useTranslation('workshop')
  return (
    <Alert variant="destructive">
      <AlertTitle>{t('estimateList.loadErrorTitle')}</AlertTitle>
      <AlertDescription>{getErrorMessage(error, t('estimateList.loadErrorFallback'))}</AlertDescription>
    </Alert>
  )
}

/** Fetches the next page with the cursor of the last one. */
export function EstimateListLoadMore({
  isLoading,
  isPartialView,
  onLoadMore,
}: {
  isLoading: boolean
  /** A search or sort is active, so it only covers what is loaded so far. */
  isPartialView: boolean
  onLoadMore: () => void
}) {
  const { t } = useTranslation('workshop')
  return (
    <div className="flex flex-col items-center gap-2">
      {isPartialView ? <p className="text-center text-sm text-slate-500">{t('estimateList.partialHint')}</p> : null}
      <Button variant="outline" disabled={isLoading} onClick={onLoadMore}>
        {isLoading ? t('estimateList.loadingMore') : t('estimateList.loadMore')}
      </Button>
    </div>
  )
}
