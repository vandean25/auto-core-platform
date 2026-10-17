import { AlertCircle, CloudCheck, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DocumentSaveStatus } from '@/hooks/useDebouncedAutoSave'

type Props = {
  status: DocumentSaveStatus
}

export function CheckInSaveIndicator({ status }: Props) {
  const { t } = useTranslation('workshop')

  if (status === 'idle') {
    return null
  }

  return (
    <div
      className="flex min-h-11 items-center justify-end gap-2 text-sm text-muted-foreground"
      data-testid="check-in-save-indicator"
      aria-live="polite"
    >
      {status === 'saving' && (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span>{t('checkIn.save.saving')}</span>
        </>
      )}
      {status === 'saved' && (
        <>
          <CloudCheck className="h-4 w-4 text-green-600" aria-hidden />
          <span>{t('checkIn.save.saved')}</span>
        </>
      )}
      {status === 'error' && (
        <>
          <AlertCircle className="h-4 w-4 text-destructive" aria-hidden />
          <span className="font-medium text-destructive">{t('checkIn.save.error')}</span>
        </>
      )}
    </div>
  )
}
