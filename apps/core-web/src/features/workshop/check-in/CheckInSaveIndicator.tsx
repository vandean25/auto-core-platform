import { AlertCircle, CloudCheck, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DocumentSaveStatus } from '@/hooks/useDebouncedAutoSave'
import type { CheckInOfflineSaveStatus } from './useCheckInOffline'

type Props = {
  status: DocumentSaveStatus
  offlineStatus?: CheckInOfflineSaveStatus
}

export function CheckInSaveIndicator({ status, offlineStatus }: Props) {
  const { t } = useTranslation('workshop')

  const effectiveStatus =
    status === 'saved' && offlineStatus === 'savedLocally'
      ? 'savedLocally'
      : status === 'idle' && offlineStatus === 'savedLocally'
        ? 'savedLocally'
        : status

  if (effectiveStatus === 'idle') {
    return null
  }

  return (
    <div
      className="flex min-h-11 items-center justify-end gap-2 text-sm text-muted-foreground"
      data-testid="check-in-save-indicator"
      aria-live="polite"
    >
      {effectiveStatus === 'saving' && (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span>{t('checkIn.save.saving')}</span>
        </>
      )}
      {effectiveStatus === 'saved' && (
        <>
          <CloudCheck className="h-4 w-4 text-green-600" aria-hidden />
          <span>{t('checkIn.save.saved')}</span>
        </>
      )}
      {effectiveStatus === 'savedLocally' && (
        <>
          <CloudCheck className="h-4 w-4 text-amber-600" aria-hidden />
          <span>{t('checkIn.save.savedLocally')}</span>
        </>
      )}
      {effectiveStatus === 'error' && (
        <>
          <AlertCircle className="h-4 w-4 text-destructive" aria-hidden />
          <span className="font-medium text-destructive">{t('checkIn.save.error')}</span>
        </>
      )}
    </div>
  )
}
