import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type LocaleBundleLoadFailedProps = {
  onRetry: () => void
  className?: string
  retryButtonClassName?: string
}

export function LocaleBundleLoadFailed({ onRetry, className, retryButtonClassName }: LocaleBundleLoadFailedProps) {
  const { t } = useTranslation('common')

  return (
    <div className={className ?? 'flex flex-col items-center justify-center gap-3 px-4 py-12 text-center'} role="alert">
      <p className="text-sm text-muted-foreground">{t('localeBundle.loadFailed')}</p>
      <Button
        type="button"
        variant="outline"
        className={cn('min-h-11 min-w-11', retryButtonClassName)}
        onClick={onRetry}
      >
        {t('localeBundle.retry')}
      </Button>
    </div>
  )
}
