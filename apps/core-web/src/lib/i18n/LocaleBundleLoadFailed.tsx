import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

type LocaleBundleLoadFailedProps = {
  onRetry: () => void
  className?: string
}

export function LocaleBundleLoadFailed({ onRetry, className }: LocaleBundleLoadFailedProps) {
  const { t } = useTranslation('common')

  return (
    <div className={className ?? 'flex flex-col items-center justify-center gap-3 px-4 py-12 text-center'} role="alert">
      <p className="text-sm text-slate-600">{t('localeBundle.loadFailed')}</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        {t('localeBundle.retry')}
      </Button>
    </div>
  )
}
