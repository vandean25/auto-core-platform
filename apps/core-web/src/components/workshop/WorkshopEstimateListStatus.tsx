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
export function EstimateListLoadMore({ isLoading, onLoadMore }: { isLoading: boolean; onLoadMore: () => void }) {
  const { t } = useTranslation('workshop')
  return (
    <div className="flex justify-center">
      <Button variant="outline" disabled={isLoading} onClick={onLoadMore}>
        {isLoading ? t('estimateList.loadingMore') : t('estimateList.loadMore')}
      </Button>
    </div>
  )
}
